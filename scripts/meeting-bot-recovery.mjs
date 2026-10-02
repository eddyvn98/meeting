import { parseParticipantCount } from "./meeting-bot-lifecycle.mjs";
import {
  clickIfVisible,
  errorCode,
  readTeamsPage,
} from "./meeting-bot-teams.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTeamsRecovery({
  launchTeams,
  closeTeams,
  joinTeams,
  reconnectTimeoutMs,
  rejoinWindowMs,
  rejoinAttemptMs,
}) {
  async function reconnectTeams(current, session, heartbeat, sinkName, storageState) {
    await closeTeams(current);
    const deadline = Date.now() + reconnectTimeoutMs;
    let lastError;

    while (Date.now() < deadline) {
      let next;
      try {
        next = await launchTeams(sinkName, storageState);
        if (await joinTeams(next, session, heartbeat, Math.min(60_000, reconnectTimeoutMs))) {
          return next;
        }
        await closeTeams(next);
        return null;
      } catch (error) {
        lastError = error;
        await closeTeams(next);
        const code = errorCode(error);
        if (["TEAMS_JOIN_REJECTED", "TEAMS_REMOVED", "TEAMS_ACCESS_DENIED", "TEAMS_INVALID_LINK"].includes(code)) {
          throw error;
        }
        await sleep(5_000);
      }
    }

    const error = new Error(
      `Teams connection could not be recovered: ${lastError instanceof Error ? lastError.message : "timeout"}`,
    );
    error.code = "TEAMS_RECOVERY_FAILED";
    throw error;
  }

  async function confirmSomeoneElseIsPresent(page, timeoutMs = 30_000) {
    await clickIfVisible(page, [/^People$/i, /^Participants$/i, /Người tham gia/i]).catch(() => false);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const snapshot = await readTeamsPage(page);
      if (["REMOVED", "REJECTED", "MEETING_ENDED", "PAGE_CLOSED"].includes(snapshot.state)) {
        return false;
      }
      const count = parseParticipantCount(snapshot.body);
      if (typeof count === "number" && count > 1) return true;
      await sleep(2_000);
    }
    return false;
  }

  async function waitForMeetingRestart(current, session, heartbeat, sinkName, storageState) {
    if (rejoinWindowMs <= 0) return null;
    const deadline = Date.now() + rejoinWindowMs;
    let runtime = current;
    await sleep(Math.min(15_000, Math.max(0, rejoinWindowMs)));

    while (Date.now() < deadline) {
      try {
        runtime = await reconnectTeams(runtime, session, heartbeat, sinkName, storageState);
        if (!runtime) return null;
        if (await confirmSomeoneElseIsPresent(runtime.page)) return runtime;
      } catch (error) {
        const code = errorCode(error);
        if (["TEAMS_JOIN_REJECTED", "TEAMS_REMOVED", "TEAMS_ACCESS_DENIED", "TEAMS_INVALID_LINK"].includes(code)) {
          throw error;
        }
      }

      await closeTeams(runtime);
      runtime = null;
      await sleep(Math.min(rejoinAttemptMs, Math.max(0, deadline - Date.now())));
    }
    return null;
  }

  return { reconnectTeams, waitForMeetingRestart };
}
