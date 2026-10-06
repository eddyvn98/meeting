import { describe, expect, it, vi } from "vitest";
import { maybeRecoverSilentAudio } from "../../scripts/meeting-bot-audio-watch.mjs";

function health() {
  return {
    trackReadyState: "live",
    trackEnabled: true,
    startedAt: Date.now() - 120_000,
    lastSignalAt: null,
    rms: 0,
    peakRms: 0,
  };
}

describe("meeting bot audio watchdog", () => {
  it("does not start recovery cooldown while participant count is unknown", async () => {
    const reconnectTeams = vi.fn();
    const result = await maybeRecoverSilentAudio({
      recorderRuntime: { audioHealth: vi.fn(async () => health()), pause: vi.fn(), resume: vi.fn() },
      reconnectTeams,
      recorder: {},
      teamsRuntime: { id: "teams" },
      session: { id: "session-a" },
      heartbeat: {},
      sink: { sinkName: "sink" },
      storageState: undefined,
      participantCount: undefined,
      lastRecoveryAt: null,
      audioInitialWarnMs: 60_000,
      audioSilenceWarnMs: 180_000,
    });

    expect(result.lastRecoveryAt).toBeNull();
    expect(reconnectTeams).not.toHaveBeenCalled();
  });

  it("recovers immediately once another participant is known", async () => {
    const recovered = { id: "recovered" };
    const pause = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const reconnectTeams = vi.fn(async () => recovered);
    const result = await maybeRecoverSilentAudio({
      recorderRuntime: { audioHealth: vi.fn(async () => health()), pause, resume },
      reconnectTeams,
      recorder: {},
      teamsRuntime: { id: "teams" },
      session: { id: "session-a" },
      heartbeat: {},
      sink: { sinkName: "sink" },
      storageState: undefined,
      participantCount: 2,
      lastRecoveryAt: null,
      audioInitialWarnMs: 60_000,
      audioSilenceWarnMs: 180_000,
    });

    expect(reconnectTeams).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(result.teamsRuntime).toBe(recovered);
    expect(typeof result.lastRecoveryAt).toBe("number");
  });
});
