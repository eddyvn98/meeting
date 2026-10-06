import { describe, expect, it, vi } from "vitest";
import { createSessionControl } from "../../scripts/meeting-bot-control.mjs";

describe("meeting bot session control", () => {
  it("stops when the server asks for STOP_REQUESTED", async () => {
    const api = vi.fn(async () => ({
      status: "STOP_REQUESTED",
      runnerId: "runner-a",
    }));
    const control = createSessionControl({
      api,
      emit: vi.fn(),
      runnerId: "runner-a",
    });

    await expect(control.shouldStop("session-1")).resolves.toBe(true);
  });

  it("throws when lease ownership is lost", async () => {
    const api = vi.fn(async () => ({
      status: "CAPTURING",
      runnerId: "runner-b",
    }));
    const control = createSessionControl({
      api,
      emit: vi.fn(),
      runnerId: "runner-a",
    });

    await expect(control.shouldStop("session-1")).rejects.toMatchObject({
      code: "SESSION_LEASE_LOST",
    });
  });

  it("throws when the session was already failed by stale-lease recovery", async () => {
    const api = vi.fn(async () => ({
      status: "FAILED",
      runnerId: null,
    }));
    const control = createSessionControl({
      api,
      emit: vi.fn(),
      runnerId: "runner-a",
    });

    await expect(control.shouldStop("session-1")).rejects.toMatchObject({
      code: "SESSION_LEASE_LOST",
    });
  });

  it("does not stop on a temporary control-plane failure", async () => {
    const api = vi.fn(async () => {
      throw new Error("temporary network failure");
    });
    const control = createSessionControl({
      api,
      emit: vi.fn(),
      runnerId: "runner-a",
    });

    await expect(control.shouldStop("session-1")).resolves.toBe(false);
  });
  it("serializes heartbeat writes so an older request cannot finish after a newer transition", async () => {
    const calls = [];
    let releaseFirst;
    const first = new Promise((resolve) => { releaseFirst = resolve; });
    const emit = vi.fn(async (_sessionId, status, extra) => {
      calls.push({ status, expectedStatus: extra.expectedStatus });
      if (calls.length === 1) await first;
      return { status, runnerId: "runner-a" };
    });
    const control = createSessionControl({
      api: vi.fn(),
      emit,
      runnerId: "runner-a",
    });
    const heartbeat = control.createHeartbeat("session-1");

    const joining = heartbeat.update("JOINING");
    const joined = heartbeat.update("JOINED");
    await Promise.resolve();
    expect(calls).toEqual([{ status: "JOINING", expectedStatus: "CLAIMED" }]);

    releaseFirst();
    await joining;
    await joined;
    heartbeat.stop();

    expect(calls).toEqual([
      { status: "JOINING", expectedStatus: "CLAIMED" },
      { status: "JOINED", expectedStatus: "JOINING" },
    ]);
  });

  it("treats a concurrent server stop request as a successful race", async () => {
    const conflict = Object.assign(new Error("Stale bot lifecycle update."), { status: 409 });
    const emit = vi.fn(async () => { throw conflict; });
    const api = vi.fn(async () => ({
      status: "STOP_REQUESTED",
      runnerId: "runner-a",
    }));
    const control = createSessionControl({ api, emit, runnerId: "runner-a" });
    const heartbeat = control.createHeartbeat("session-1");

    await expect(heartbeat.update("CAPTURING")).resolves.toMatchObject({
      status: "STOP_REQUESTED",
    });
    heartbeat.stop();
  });

});
