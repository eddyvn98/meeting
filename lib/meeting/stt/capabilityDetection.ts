/**
 * lib/meeting/stt/capabilityDetection.ts
 *
 * GPU/CPU capability detection for STT model-variant selection, per the
 * spec's flow: check `navigator.gpu` exists -> `await
 * navigator.gpu.requestAdapter()` -> cache the result for the session.
 *
 * IMPORTANT: `requestAdapter()` resolving to a non-null adapter means the
 * browser *can* talk to a GPU via WebGPU — it does NOT mean a specific WASM
 * model will actually initialize on it (driver quirks, out-of-memory on a
 * large model, an extension/flag disabling compute shaders, etc. can all
 * still fail at model-load time). So this module never asserts "GPU is
 * usable" on its own; it only asserts "GPU is worth trying". The actual
 * provider (see whisperCppProvider.ts) must call `reportGpuInitFailure()`
 * when its GPU code path throws, which permanently downgrades the cached
 * capability to "cpu" for the rest of the session so every subsequent
 * `detectCapability()` call (including ones from providerFactory on a later
 * meeting) stops retrying the GPU path and falls back cleanly.
 */

export type CapabilityTier = "gpu" | "cpu";

export interface CapabilityInfo {
  tier: CapabilityTier;
  /** Why this tier was chosen — surfaced in logs/telemetry, not shown to
   *  end users directly. */
  reason: string;
}

let cached: CapabilityInfo | null = null;
/** Set once a provider reports its GPU init failed; makes every later
 *  detection permanently prefer CPU for this session even if a fresh
 *  `requestAdapter()` would still succeed. */
let gpuKnownBad = false;

/** Runs the navigator.gpu -> requestAdapter() probe once per session and
 *  caches the result. Safe to call from multiple providers/screens — later
 *  calls just return the cached value (or re-resolve after
 *  `resetCapabilityCache()`, used by tests). */
export async function detectCapability(): Promise<CapabilityInfo> {
  if (cached) return cached;

  if (gpuKnownBad) {
    cached = { tier: "cpu", reason: "gpu-init-previously-failed" };
    return cached;
  }

  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    cached = { tier: "cpu", reason: "navigator.gpu-unavailable" };
    return cached;
  }

  try {
    // navigator.gpu exists whenever "gpu" in navigator is true; cast keeps
    // this file buildable without pulling in @webgpu/types as a dependency.
    const gpu = (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = await gpu.requestAdapter();
    cached = adapter
      ? { tier: "gpu", reason: "requestAdapter-resolved" }
      : { tier: "cpu", reason: "requestAdapter-returned-null" };
  } catch (err) {
    cached = {
      tier: "cpu",
      reason: `requestAdapter-threw:${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return cached;
}

/** Call this when a GPU-path provider fails to actually load/run its model
 *  after `detectCapability()` returned "gpu" — see the module doc comment
 *  above for why requestAdapter success alone isn't trusted. Downgrades the
 *  cache immediately so any provider still mid-selection (e.g. diarization
 *  picking its variant after STT already tried and failed) sees "cpu" too. */
export function reportGpuInitFailure(reason: string): void {
  gpuKnownBad = true;
  cached = { tier: "cpu", reason: `gpu-init-failed:${reason}` };
}

/** Test/debug-only: clears the cached capability and the sticky
 *  gpu-known-bad flag so the next `detectCapability()` call re-probes. */
export function resetCapabilityCache(): void {
  cached = null;
  gpuKnownBad = false;
}
