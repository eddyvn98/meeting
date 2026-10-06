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

  it("finishes ENDED after a concurrent stop request instead of leaving STOP_REQUESTED stale", async () => {
    const conflict = Object.assign(new Error("Stale bot lifecycle update."), { status: 409 });
    let call = 0;
    const emit = vi.fn(async (_sessionId, status, extra) => {
      call += 1;
      if (call === 1) throw conflict;
      return { status, runnerId: "runner-a", expectedStatus: extra.expectedStatus };
    });
    const api = vi.fn(async () => ({
      status: "STOP_REQUESTED",
      runnerId: "runner-a",
    }));
    const control = createSessionControl({ api, emit, runnerId: "runner-a" });
    const heartbeat = control.createHeartbeat("session-1");

    await expect(heartbeat.update("ENDED")).resolves.toMatchObject({ status: "ENDED" });
    heartbeat.stop();

    expect(emit).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "ENDED",
      expect.objectContaining({ expectedStatus: "STOP_REQUESTED" }),
    );
  });

  it("does not advance acknowledged lifecycle state after a failed write", async () => {
    const calls = [];
    let attempt = 0;
    const emit = vi.fn(async (_sessionId, status, extra) => {
      calls.push({ status, expectedStatus: extra.expectedStatus });
      attempt += 1;
      if (attempt === 1) throw new Error("temporary write failure");
      return { status, runnerId: "runner-a" };
    });
    const control = createSessionControl({
      api: vi.fn(),
      emit,
      runnerId: "runner-a",
    });
    const heartbeat = control.createHeartbeat("session-1");

    await expect(heartbeat.update("JOINING")).rejects.toThrow("temporary write failure");
    await expect(heartbeat.update("JOINING")).resolves.toMatchObject({ status: "JOINING" });
    heartbeat.stop();

    expect(calls).toEqual([
      { status: "JOINING", expectedStatus: "CLAIMED" },
      { status: "JOINING", expectedStatus: "CLAIMED" },
    ]);
  });

  it("tracks control-plane outage grace independently per session", async () => {
    let now = 1_000;
    const api = vi.fn(async (path) => {
      if (path.includes("session-2")) return { status: "CAPTURING", runnerId: "runner-a" };
      throw new Error("network down");
    });
    const control = createSessionControl({
      api,
      emit: vi.fn(),
      runnerId: "runner-a",
      controlOutageGraceMs: 5_000,
      now: () => now,
    });

    await expect(control.shouldStop("session-1")).resolves.toBe(false);
    now += 4_000;
    await expect(control.shouldStop("session-2")).resolves.toBe(false);
    now += 1_000;
    await expect(control.shouldStop("session-1")).rejects.toMatchObject({
      code: "CONTROL_PLANE_UNAVAILABLE",
    });
    await expect(control.shouldStop("session-2")).resolves.toBe(false);
  });

  it("fails closed when the control plane stays unreachable past the grace period", async () => {
    let now = 1_000;
    const control = createSessionControl({
      api: vi.fn(async () => { throw new Error("network down"); }),
      emit: vi.fn(),
      runnerId: "runner-a",
      controlOutageGraceMs: 5_000,
      now: () => now,
    });

    await expect(control.shouldStop("session-1")).resolves.toBe(false);
    now += 4_999;
    await expect(control.shouldStop("session-1")).resolves.toBe(false);
    now += 1;
    await expect(control.shouldStop("session-1")).rejects.toMatchObject({
      code: "CONTROL_PLANE_UNAVAILABLE",
    });
  });

});
