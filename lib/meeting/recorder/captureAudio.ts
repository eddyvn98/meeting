/**
 * lib/meeting/recorder/captureAudio.ts
 *
 * Acquires the audio to record: tab/window/screen audio via getDisplayMedia
 * for human recordings, or a PulseAudio-backed microphone source for the
 * unattended Linux meeting bot. Returns a single mixed MediaStream. Missing
 * or silent audio never blocks a recording: pressing record always records.
 */

import type { CaptureError, CaptureSource } from "./types";
export type { CaptureSource } from "./types";
export interface CaptureResult {
  stream: MediaStream;
  /** Underlying raw streams, kept so the caller can stop every track
   *  (display capture, mic) on teardown — stopping only the mixed
   *  destination stream leaves the originals running. */
  rawStreams: MediaStream[];
  /** The Web Audio context created to mix rawStreams into `stream`. Must be
   *  passed to stopCapture() on teardown — leaving it open leaks the
   *  context (and any native resources behind it) for the life of the tab. */
  audioCtx: AudioContext;
  error: null;
}
export interface CaptureFailure {
  stream: null;
  rawStreams: MediaStream[];
  error: CaptureError;
}
/**
 * getDisplayMedia requires a transient user activation in Chromium.  A route
 * change consumes that activation, so the recording page cannot safely ask
 * for capture from a mount-time effect.  Keep a successfully prepared stream
 * on window while the app moves from Meeting Home to the recording route.
 * MediaStream objects are intentionally kept out of React state and out of
 * the URL; they are live browser capabilities, not serializable app data.
 */
const PREPARED_CAPTURE_KEY = "__aiWebChatPreparedMeetingCapture";

interface PreparedCaptureWindow extends Window {
  [PREPARED_CAPTURE_KEY]?: CaptureResult;
}

function fail(reason: CaptureError["reason"], message: string, rawStreams: MediaStream[] = []): CaptureFailure {
  return { stream: null, rawStreams, error: { reason, message } };
}
function stopAll(streams: MediaStream[]): void {
  for (const s of streams) for (const t of s.getTracks()) t.stop();
}

// Chrome's getDisplayMedia tab-audio track can report `muted: false` /
// `readyState: "live"` while genuinely delivering zero samples to any
// MediaStreamAudioSourceNode built from it — confirmed live (see the
// meeting's own debug log: audioCtx "running", 600ms sampled, maxDeviation
// 0) even though the tab was actively playing sound. A known workaround:
// attaching the track to a real (muted, so nothing double-plays out loud)
// <audio> element and calling play() is what actually starts the browser
// delivering data through it — Web Audio alone never triggers that for a
// display-capture track the way it does for a getUserMedia mic track.
// Kept in this array (not just a local var) so it isn't garbage collected
// mid-recording; stopCapture() tears them down.
let wakeElements: HTMLAudioElement[] = [];

function wakeUpTrack(stream: MediaStream): void {
  if (typeof document === "undefined" || stream.getAudioTracks().length === 0) return;
  const el = document.createElement("audio");
  el.muted = true;
  el.autoplay = true;
  el.style.display = "none";
  el.srcObject = stream;
  document.body.appendChild(el);
  void el.play().catch(() => {});
  wakeElements.push(el);
}

function stopWakeElements(): void {
  for (const el of wakeElements) {
    el.pause();
    el.srcObject = null;
    el.remove();
  }
  wakeElements = [];
}

/** Mixes N audio-only MediaStreams into one via Web Audio, so a single
 *  MediaRecorder can chunk the combined tab + mic audio together. */
async function mixAudioStreams(streams: MediaStream[]): Promise<{ stream: MediaStream; audioCtx: AudioContext }> {
  const AudioContextCtor = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error("This browser does not support audio processing.");
  const audioCtx = new AudioContextCtor();
  try {
    // A freshly-constructed AudioContext can start "suspended" — by the time
    // this runs (after the getDisplayMedia/getUserMedia awaits above), we're
    // no longer inside the synchronous click-handler stack Chrome's autoplay
    // policy looks for, so it isn't guaranteed to auto-resume. A suspended
    // context silently processes nothing: every AnalyserNode read comes back
    // as flat silence regardless of the real signal. resume() is a no-op if
    // already running.
    await audioCtx.resume();
    const destination = audioCtx.createMediaStreamDestination();
    for (const s of streams) {
      if (s.getAudioTracks().length === 0) continue;
      const source = audioCtx.createMediaStreamSource(s);
      source.connect(destination);
    }
    return { stream: destination.stream, audioCtx };
  } catch (error) {
    await audioCtx.close().catch(() => {});
    throw error;
  }
}

async function createCaptureResult(rawStreams: MediaStream[]): Promise<CaptureResult | CaptureFailure> {
  try {
    const { stream, audioCtx } = await mixAudioStreams(rawStreams);
    return { stream, rawStreams, audioCtx, error: null };
  } catch (error) {
    stopAll(rawStreams);
    stopWakeElements();
    return fail("unknown", describeError(error));
  }
}

async function safeMixAudioStreams(streams: MediaStream[]): Promise<CaptureResult | CaptureFailure> {
  try {
    const mixed = await mixAudioStreams(streams);
    return { stream: mixed.stream, rawStreams: streams, audioCtx: mixed.audioCtx, error: null };
  } catch (error) {
    stopAll(streams);
    stopWakeElements();
    return fail("not-supported", describeError(error));
  }
}

/** Primary capture path: tab/window/screen audio. Rejects only if the
 *  browser doesn't support getDisplayMedia or the user cancels; a source with
 *  no audio track (or silent audio) does not stop the recording. */
async function captureDisplayAudio(): Promise<MediaStream | CaptureError> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return { reason: "not-supported", message: "This browser does not support screen/tab audio capture." };
  }
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    return { reason: "permission-denied", message: describeError(err) };
  }
  // A share without audio (or with a silent source) is still allowed: the
  // recording starts anyway and simply captures silence / the microphone.
  // We only need the audio; stop the video track immediately so the browser
  // doesn't keep rendering the "sharing" indicator around a stream we never
  // display.
  for (const t of display.getVideoTracks()) t.stop();
  return display;
}

/** Best-effort mic supplement for desktop display capture. */
async function captureMicAudio(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
}

async function captureBotAudio(): Promise<MediaStream | CaptureError> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { reason: "not-supported", message: "This browser does not support microphone audio capture." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (stream.getAudioTracks().length === 0) {
      stopAll([stream]);
      return { reason: "no-audio-track", message: "The bot audio source did not expose an audio track." };
    }
    return stream;
  } catch (err) {
    return { reason: "permission-denied", message: describeError(err) };
  }
}

async function captureMicrophone(): Promise<MediaStream | CaptureError> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { reason: "not-supported", message: "This browser does not support microphone recording." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (stream.getAudioTracks().length === 0) {
      stopAll([stream]);
      return { reason: "no-audio-track", message: "The microphone did not provide an audio track." };
    }
    return stream;
  } catch (err) {
    return { reason: "permission-denied", message: describeError(err) };
  }
}

function isBotCaptureMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("capture") === "bot-audio";
}
function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Permission to capture audio was denied.";
  }
  return err instanceof Error ? err.message : "Failed to start audio capture.";
}

export async function startCapture(source: CaptureSource = "display"): Promise<CaptureResult | CaptureFailure> {
  if (isBotCaptureMode()) {
    const botAudio = await captureBotAudio();
    if (!("getAudioTracks" in botAudio)) return fail(botAudio.reason, botAudio.message);
    wakeUpTrack(botAudio);
    const result = await createCaptureResult([botAudio]);
    if (!result.error) console.info("[meeting] bot audio track is live; initial silence is allowed");
    return result;
  }
  if (source === "microphone") {
    const microphone = await captureMicrophone();
    if (!("getAudioTracks" in microphone)) return fail(microphone.reason, microphone.message);
    wakeUpTrack(microphone);
    return safeMixAudioStreams([microphone]);
  }

  const display = await captureDisplayAudio();
  if (!("getAudioTracks" in display)) return fail(display.reason, display.message);

  console.info(
    "[meeting] display audio tracks",
    display.getAudioTracks().map((t) => ({ label: t.label, readyState: t.readyState, muted: t.muted, enabled: t.enabled })),
  );
  wakeUpTrack(display);

  const mic = await captureMicAudio();
  if (mic) wakeUpTrack(mic);
  const rawStreams = mic ? [display, mic] : [display];

  return createCaptureResult(rawStreams);
}

export function stopCapture(rawStreams: MediaStream[], audioCtx?: AudioContext | null): void {
  stopAll(rawStreams);
  stopWakeElements();
  if (audioCtx && audioCtx.state !== "closed") void audioCtx.close().catch(() => {});
}

export function hasPreparedCapture(): boolean {
  return typeof window !== "undefined" && Boolean((window as PreparedCaptureWindow)[PREPARED_CAPTURE_KEY]);
}

/** Acquire capture during the Start Meeting click, before navigation. */
export async function prepareCapture(source: CaptureSource = "display"): Promise<CaptureResult | CaptureFailure> {
  if (typeof window !== "undefined") {
    const previous = (window as PreparedCaptureWindow)[PREPARED_CAPTURE_KEY];
    if (previous) {
      stopCapture(previous.rawStreams, previous.audioCtx);
      delete (window as PreparedCaptureWindow)[PREPARED_CAPTURE_KEY];
    }
  }

  const result = await startCapture(source);
  if (!result.error && typeof window !== "undefined") {
    (window as PreparedCaptureWindow)[PREPARED_CAPTURE_KEY] = result;
  }
  return result;
}

/** Consume the stream prepared by Meeting Home, exactly once. */
export function takePreparedCapture(): CaptureResult | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as PreparedCaptureWindow;
  const prepared = browserWindow[PREPARED_CAPTURE_KEY] ?? null;
  delete browserWindow[PREPARED_CAPTURE_KEY];
  return prepared;
}
