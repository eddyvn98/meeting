"use client";

export interface BotAudioHealthSnapshot {
  startedAt: number;
  lastSampleAt: number;
  lastSignalAt: number | null;
  rms: number;
  peakRms: number;
  contextState: AudioContextState;
}

interface BotAudioHealthWindow extends Window {
  __meetingBotAudioHealth?: BotAudioHealthSnapshot;
  __meetingBotAudioHealthStop?: () => void;
}

const SAMPLE_MS = 250;
const SIGNAL_RMS = 0.0015;

export async function startBotAudioHealthMonitor(stream: MediaStream): Promise<void> {
  if (typeof window === "undefined" || stream.getAudioTracks().length === 0) return;
  stopBotAudioHealthMonitor();

  const audioCtx = new AudioContext();
  await audioCtx.resume().catch(() => undefined);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);

  const data = new Float32Array(analyser.fftSize);
  const startedAt = Date.now();
  const snapshot: BotAudioHealthSnapshot = {
    startedAt,
    lastSampleAt: startedAt,
    lastSignalAt: null,
    rms: 0,
    peakRms: 0,
    contextState: audioCtx.state,
  };
  const target = window as BotAudioHealthWindow;
  target.__meetingBotAudioHealth = snapshot;

  const timer = window.setInterval(() => {
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => undefined);
    snapshot.contextState = audioCtx.state;
    analyser.getFloatTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i += 1) sumSquares += data[i] * data[i];
    const rms = Math.sqrt(sumSquares / data.length);
    const now = Date.now();
    snapshot.lastSampleAt = now;
    snapshot.rms = rms;
    snapshot.peakRms = Math.max(snapshot.peakRms, rms);
    if (rms >= SIGNAL_RMS) snapshot.lastSignalAt = now;
    target.__meetingBotAudioHealth = { ...snapshot };
  }, SAMPLE_MS);

  target.__meetingBotAudioHealthStop = () => {
    window.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    void audioCtx.close().catch(() => undefined);
    delete target.__meetingBotAudioHealthStop;
  };
}

export function stopBotAudioHealthMonitor(): void {
  if (typeof window === "undefined") return;
  const target = window as BotAudioHealthWindow;
  target.__meetingBotAudioHealthStop?.();
  delete target.__meetingBotAudioHealth;
}
