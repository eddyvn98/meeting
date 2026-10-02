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
});
