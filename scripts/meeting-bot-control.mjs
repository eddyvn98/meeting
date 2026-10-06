import { errorCode } from "./meeting-bot-teams.mjs";

export function createSessionControl({
  api,
  emit,
  runnerId,
  controlOutageGraceMs = 60_000,
  now = Date.now,
}) {
  let controlFailureSince = null;
  function createHeartbeat(sessionId) {
    let acknowledgedStatus = "CLAIMED";
    let rememberedStatus = "CLAIMED";
    let rememberedExtra = {};
    let stopped = false;
    let queue = Promise.resolve();

    const send = (nextStatus, nextExtra = {}, { remember = true } = {}) => {
      if (remember) {
        rememberedStatus = nextStatus;
        rememberedExtra = nextExtra;
      }
      const run = queue.then(async () => {
        const expectedStatus = acknowledgedStatus;
        try {
          const current = await emit(sessionId, nextStatus, { ...nextExtra, expectedStatus });
          if (current?.status) acknowledgedStatus = current.status;
          return current;
        } catch (error) {
          if (error && typeof error === "object" && error.status === 409) {
            const current = await api(
              `/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}`,
            );
            if (
              current?.runnerId === runnerId &&
              (current.status === nextStatus || current.status === "STOP_REQUESTED")
            ) {
              acknowledgedStatus = current.status;
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
      void send(rememberedStatus, rememberedExtra, { remember: false }).catch(() => undefined);
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
      if (!session) throw new Error("Bot session control response was empty.");

      controlFailureSince = null;
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
      controlFailureSince ??= now();
      if (now() - controlFailureSince >= controlOutageGraceMs) {
        const unavailable = new Error(
          "Meeting bot control plane stayed unreachable past the safety grace period.",
        );
        unavailable.code = "CONTROL_PLANE_UNAVAILABLE";
        throw unavailable;
      }
      return false;
    }
  }

  return { createHeartbeat, shouldStop };
}
