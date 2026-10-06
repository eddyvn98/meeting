import { errorCode } from "./meeting-bot-teams.mjs";

export function createSessionControl({ api, emit, runnerId }) {
  function createHeartbeat(sessionId) {
    let status = "CLAIMED";
    let extra = {};
    let stopped = false;
    let queue = Promise.resolve();

    const send = (nextStatus, nextExtra = {}, { remember = true } = {}) => {
      const expectedStatus = status;
      if (remember) {
        status = nextStatus;
        extra = nextExtra;
      }
      const run = queue.then(async () => {
        try {
          return await emit(sessionId, nextStatus, { ...nextExtra, expectedStatus });
        } catch (error) {
          if (error && typeof error === "object" && error.status === 409) {
            const current = await api(
              `/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}`,
            );
            if (
              current?.runnerId === runnerId &&
              (current.status === nextStatus || current.status === "STOP_REQUESTED")
            ) {
              return current;
            }
          }
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    };

    const timer = setInterval(() => {
      if (stopped) return;
      void send(status, extra, { remember: false }).catch(() => undefined);
    }, 15_000);

    return {
      update(nextStatus, nextExtra = {}) {
        return send(nextStatus, nextExtra);
      },
      stop() {
        stopped = true;
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
