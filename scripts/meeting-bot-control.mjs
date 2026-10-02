import { errorCode } from "./meeting-bot-teams.mjs";

export function createSessionControl({ api, emit, runnerId }) {
  function createHeartbeat(sessionId) {
    let status = "CLAIMED";
    let extra = {};
    const timer = setInterval(() => {
      void emit(sessionId, status, extra).catch(() => undefined);
    }, 15_000);

    return {
      update(nextStatus, nextExtra = {}) {
        status = nextStatus;
        extra = nextExtra;
        return emit(sessionId, status, extra);
      },
      stop() {
        clearInterval(timer);
      },
    };
  }

  async function shouldStop(sessionId) {
    try {
      const session = await api(
        `/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}`,
      );
      if (!session) return false;

      const leaseLost =
        session.runnerId !== runnerId ||
        ["REQUESTED", "ENDED", "FAILED"].includes(session.status);
      if (leaseLost) {
        const error = new Error(
          "The bot session lease is no longer owned by this runner.",
        );
        error.code = "SESSION_LEASE_LOST";
        throw error;
      }

      return session.status === "STOP_REQUESTED";
    } catch (error) {
      if (errorCode(error) === "SESSION_LEASE_LOST") throw error;
      return false;
    }
  }

  return { createHeartbeat, shouldStop };
}
