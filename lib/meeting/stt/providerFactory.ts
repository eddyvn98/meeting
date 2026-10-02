/**
 * lib/meeting/stt/providerFactory.ts
 *
 * The ONLY module the rest of the app (Processing-screen pipeline, etc.)
 * should import to get a working STTProvider/DiarizationProvider pair. Picks
 * local-vs-server and GPU-vs-CPU variant based on capability detection ONLY
 * (meeting length is irrelevant here — see getSTTProviders' doc comment),
 * per the spec's flow. Everything else in lib/meeting/stt/** is an
 * implementation detail behind this function.
 */

import type { STTProviderBundle, DiarizationProvider } from "./types";
import { detectCapability } from "./capabilityDetection";
import { WorkerSTTProvider, WorkerDiarizationProvider } from "./sttWorkerClient";
import { ServerDiarizationProvider, ServerSTTProvider } from "./serverProvider";
import { getPreloadedSttProviders } from "./preloadStt";
import { isMobileDevice } from "./transcriptionMode";

export interface GetSTTProvidersOptions {
  /** Required to construct the server-fallback providers (they call
   *  /api/meeting/[meetingId]/transcribe). Pass the meeting the caller is
   *  about to process. */
  meetingId: string;
  /** Force a tier for testing/debugging instead of running capability
   *  detection. Not used in normal operation. */
  forceTier?: "gpu" | "cpu" | "server";
  /** Whisper language code (lib/meeting/sttLanguages.ts) chosen for this
   *  meeting. Only applied to the local (WorkerSTTProvider) tier — the
   *  server tier resolves it itself from the meeting's stored `sttLanguage`
   *  (see transcribe/route.ts), so it's a no-op there. Required so a
   *  preloaded (already-loaded-with-a-stale-default) instance still ends up
   *  transcribing in the right language. */
  language: string;
}

/**
 * Returns a ready-to-use { stt, diarization, tier } bundle. Meeting LENGTH
 * plays no part in this choice (it used to force the server tier past a
 * duration threshold — removed: chunkedLocalTranscription.ts now runs local
 * WASM in ~15-minute slices too, which is what actually made the "long
 * recording risks a crashed/OOM tab" concern moot, not which engine runs
 * it — a slow engine chunked into pieces still takes the same total
 * wall-clock time, it just no longer risks one giant blocking call. Anyone
 * who prefers not to have their audio leave the browser at all, regardless
 * of how long the meeting runs, gets exactly that now).
 *
 * Selection order:
 * 1. Run capability detection (navigator.gpu -> requestAdapter(), cached).
 * 2. Try the local engine — WorkerSTTProvider/WorkerDiarizationProvider,
 *    which run LocalWhisperProvider/LocalDiarizationProvider's real WASM/
 *    WebGPU inference inside a dedicated Web Worker (sttWorker.ts) instead
 *    of the tab's main thread, so a long local transcription doesn't freeze
 *    the tab — same GPU-load-fails-retries-CPU contract, just proxied
 *    (see localWhisperProvider.ts/localDiarizationProvider.ts `load()`).
 * 3. STT and diarization each fall back to their Server* counterpart
 *    independently only if the local provider's load() throws (e.g.
 *    WebAssembly unavailable, model fetch blocked) — a defensive path, not
 *    the common case.
 *
 * The Processing-screen agent should call this once per meeting, right
 * before the STT/diarization step of its pipeline, and treat the returned
 * `tier` as display-only info (e.g. "Running locally (GPU)" /
 * "Running locally (CPU)" / "Running on server").
 */
export async function getSTTProviders(
  options: GetSTTProvidersOptions,
): Promise<STTProviderBundle> {
  // Mobile devices never run the local models — always the server tier.
  const { meetingId, language } = options;
  const forceTier = isMobileDevice() ? "server" : options.forceTier;

  if (forceTier === "server") {
    return {
      stt: new ServerSTTProvider(meetingId),
      diarization: new ServerDiarizationProvider(meetingId),
      tier: "server",
    };
  }

  const capability = forceTier
    ? { tier: forceTier, reason: "forced" as const }
    : await detectCapability();

  // If the recording screen already warmed these in the background (see
  // preloadStt.ts) — reuse the same instances instead of
  // constructing (and re-downloading into) fresh ones. Preload runs before
  // the user necessarily picked a language, so it always applies the
  // default — bring it up to date with this meeting's actual language here.
  const preloaded = getPreloadedSttProviders();
  if (preloaded) {
    await preloaded.whisper.setLanguage(language);
    return { stt: preloaded.whisper, diarization: preloaded.diarization, tier: capability.tier };
  }

  try {
    const local = new WorkerSTTProvider();
    await local.load();
    await local.setLanguage(language);
    return {
      stt: local,
      // Diarization is best-effort supplementary data (a failed/unavailable
      // engine just means every segment keeps the single-implied-speaker
      // default — see mergeSpeakers.ts), so its own load failure degrades
      // only diarization to the server stub, not the whole bundle's tier.
      diarization: await loadLocalDiarizationOrFallback(meetingId),
      tier: capability.tier,
    };
  } catch (err) {
    // Logged (not swallowed): this degrades every meeting to the server stub
    // transcript, which is silently wrong-looking otherwise (looks like a
    // real but empty meeting) rather than an obvious failure.
    console.warn("[meeting] Local STT provider failed to load, falling back to server stub:", err instanceof Error ? err.message : String(err));
    return {
      stt: new ServerSTTProvider(meetingId),
      diarization: new ServerDiarizationProvider(meetingId),
      tier: "server",
    };
  }
}

export async function getDiarizationProvider(meetingId: string): Promise<DiarizationProvider> {
  if (isMobileDevice()) return new ServerDiarizationProvider(meetingId);
  const preloaded = getPreloadedSttProviders();
  if (preloaded?.diarization) {
    return preloaded.diarization;
  }
  return loadLocalDiarizationOrFallback(meetingId);
}

export async function loadLocalDiarizationOrFallback(meetingId: string): Promise<DiarizationProvider> {
  try {
    const diarization = new WorkerDiarizationProvider();
    await diarization.load();
    return diarization;
  } catch (err) {
    console.warn("[meeting] Local diarization provider failed to load, falling back to server stub:", err);
    return new ServerDiarizationProvider(meetingId);
  }
}
