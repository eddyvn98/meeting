"use client";

import { useEffect, useRef } from "react";

const BAR_COUNT = 32;
const BAR_GAP_PX = 3;
const BAR_RADIUS_PX = 2;
// A new history sample lands roughly every 90ms, so the 32 bars span ~2.9s
// of recent volume — each bar is a different MOMENT in time, not a spatial
// slice of the same instant. Slicing one ~5ms analyser buffer into 32 bars
// (the previous approach) made every bar read almost the same height for a
// steady tone, since the whole buffer was one near-constant amplitude.
const HISTORY_INTERVAL_MS = 90;
// Each bar still eases toward its latest sample instead of snapping, so a
// new history entry grows in smoothly rather than popping in.
const EASE_FACTOR = 0.3;
// Matches tailwind.config.js's "primary" (#d97706) — the same accent
// MeetingAudioPlayer uses for its play button and scrub bar, since canvas
// fillStyle can't read Tailwind classes directly.
const BAR_COLOR = "#d97706";

/** Live bar-style waveform driven by an AnalyserNode on the actual capture
 *  stream — proof to the user that audio is really coming through, not just
 *  that MediaRecorder started. Scrolls like a voice-memo waveform: each bar
 *  is the loudness at a past moment, so distinct words/pauses in real
 *  speech read as a distinct skyline instead of a flat, uniform strip.
 *  Renders silence as flat baseline bars, so a genuinely silent capture is
 *  visually distinguishable from one that just hasn't painted yet. */
export function AudioWaveform({ stream, className = "h-12 w-64" }: { stream: MediaStream | null; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext("2d");
    if (!canvas || !ctx2d) return;

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    // Rolling history of one loudness sample per HISTORY_INTERVAL_MS —
    // levels[last] is the newest; the bars scroll left as it fills.
    const levels = new Float32Array(BAR_COUNT).fill(0);
    const displayedHeights = new Float32Array(BAR_COUNT).fill(3);
    let lastSampleAt = 0;

    let rafId: number;
    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);

      // RMS over the whole buffer — one loudness number for "right now",
      // rather than a peak-per-bar split of the same instant.
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const deviation = (data[i] - 128) / 128;
        sumSquares += deviation * deviation;
      }
      const rms = Math.sqrt(sumSquares / data.length);

      if (now - lastSampleAt >= HISTORY_INTERVAL_MS) {
        levels.copyWithin(0, 1);
        levels[BAR_COUNT - 1] = rms;
        lastSampleAt = now;
      }

      const width = canvas.width;
      const height = canvas.height;
      const barWidth = width / BAR_COUNT - BAR_GAP_PX;
      ctx2d.clearRect(0, 0, width, height);
      ctx2d.fillStyle = BAR_COLOR;

      for (let bar = 0; bar < BAR_COUNT; bar++) {
        // sqrt boost — moderate-volume speech reads as a visibly tall bar
        // instead of a sliver clustered near the baseline; loud peaks still
        // cap at the full pill height.
        const targetHeight = Math.max(3, Math.sqrt(levels[bar]) * height);
        displayedHeights[bar] += (targetHeight - displayedHeights[bar]) * EASE_FACTOR;

        const barHeight = displayedHeights[bar];
        const x = bar * (barWidth + BAR_GAP_PX);
        const y = (height - barHeight) / 2;
        ctx2d.beginPath();
        ctx2d.roundRect(x, y, barWidth, barHeight, BAR_RADIUS_PX);
        ctx2d.fill();
      }
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      analyser.disconnect();
      void audioCtx.close().catch(() => {});
    };
  }, [stream]);

  return <canvas ref={canvasRef} width={256} height={48} className={className} />;
}
