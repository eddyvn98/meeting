/**
 * lib/meeting/stt/types.ts
 *
 * Framework-agnostic STT/diarization provider contract for the Meeting
 * module. The UI and the Processing-screen pipeline import ONLY these
 * interfaces (plus `providerFactory.ts`) — never a concrete engine module —
 * so the underlying WASM engine (whisper.cpp today, sherpa-onnx/Moonshine or
 * a server model later) can change without any caller edit.
 *
 * The authoritative v1 pipeline is deliberately non-streaming
 * (`transcribe`/`diarize` take a decoded audio window and resolve once). The
 * recording screen may call `transcribe` repeatedly on short windows for a
 * best-effort live preview, while preserving this stable provider contract
 * for the full post-recording pass.
 */

import type { TranscriptSegment } from "@/lib/meeting/types";

/** One STT-decoded utterance, before it is joined against SpeakerMapping /
 *  assigned a `meetingId`/`order`/`id` — that join happens server-side (see
 *  lib/meeting/types.ts TranscriptSegment doc comment), not inside a
 *  provider. Timestamps are seconds (provider-native unit for whisper.cpp
 *  and most STT engines), unlike TranscriptSegment's *Ms fields — the caller
 *  that turns this into a TranscriptSegment does the ms conversion. */
export interface STTSegment {
  start: number;
  end: number;
  text: string;
}

export interface STTResult {
  segments: STTSegment[];
}

/** One diarization-detected speaker turn. `speakerIndex` is the stable
 *  0-based slot order the engine assigned within this run (used to derive
 *  `speakerKey` = `speaker_${speakerIndex + 1}`, matching lib/meeting/types.ts
 *  Speaker.speakerKey convention); `speakerId` is whatever opaque id/label
 *  the engine itself produced (useful for debugging, not for display). */
export interface DiarizationSpan {
  startTime: number;
  duration: number;
  speakerId: string;
  speakerIndex: number;
  /** Set only when this span matched a company-wide voice-library profile
   *  (see speakerClustering.ts's `seedProfiles`) — lets the caller
   *  auto-create a SpeakerMapping instead of leaving `speaker_N` for a
   *  colleague whose voice has already been enrolled in a past meeting. */
  recognizedName?: string;
}

export interface DiarizationResult {
  spans: DiarizationSpan[];
}

/** Implemented by every STT engine (local WASM or server-backed). Audio is
 *  always mono 32-bit float PCM at the given sample rate — callers are
 *  responsible for decoding/resampling upstream (the recording pipeline
 *  agent's concern, not this module's). */
export interface STTProvider {
  /** Stable id for logging/telemetry, e.g. "whisper-cpp-wasm-cpu", "server". */
  readonly id: string;
  transcribe(audio: Float32Array, sampleRate: number): Promise<STTResult>;
}

export interface DiarizationProvider {
  readonly id: string;
  diarize(audio: Float32Array, sampleRate: number): Promise<DiarizationResult>;
}

/** Convenience shape `providerFactory.ts` returns — one matched STT +
 *  diarization pair plus which capability tier produced it, so the
 *  Processing-screen agent can show e.g. "Running on GPU" without re-deriving
 *  capability state itself. */
export interface STTProviderBundle {
  stt: STTProvider;
  diarization: DiarizationProvider;
  tier: "gpu" | "cpu" | "server";
}

/** Helper (not required, but keeps Processing-screen code from hand-rolling
 *  the STTSegment -> TranscriptSegment field mapping) — exported for callers
 *  that want it; providers never call this themselves. */
export type PartialTranscriptSegment = Pick<
  TranscriptSegment,
  "startTimeMs" | "endTimeMs" | "textEn"
>;
