import { chromium } from "@playwright/test";
import { createPulseAudioSession } from "./meeting-bot-audio.mjs";
import {
  initialAloneState,
  isAloneFromCount,
  isMaxDurationExceeded,
  nextAloneState,
  parseParticipantCount,
} from "./meeting-bot-lifecycle.mjs";
import {
  clickIfVisible,
  codedError,
  errorCode,
  prepareTeamsPage,
  readTeamsPage,
  waitForTeamsJoin,
} from "./meeting-bot-teams.mjs";

const ACTIVE_STATUSES = new Set([
  "REQUESTED", "CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING", "STOP_REQUESTED",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBotSessionRunner({
  api,
  emit,
  recorderRuntime,
  runnerId,
  teamsDisplayName,
  browserChannel,
  browserExecutable,
  headless,
  pollMs,
  lobbyTimeoutMs,
  reconnectTimeoutMs,
  rejoinWindowMs,
  rejoinAttemptMs,
  aloneTimeoutMs,
  maxDurationMs,
  audioInitialWarnMs,
  audioSilenceWarnMs,
}) {
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
      stop() { clearInterval(timer); },
    };
  }

  async function shouldStop(sessionId) {
    try {
      const session = await api(`/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}`);
      return session?.status === "STOP_REQUESTED";
    } catch {
      return false;
    }
  }

  async function launchTeams(sinkName, storageState) {
    const browser = await chromium.launch({
      ...(browserChannel ? { channel: browserChannel } : {}),
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      headless,
      env: { ...process.env, PULSE_SINK: sinkName },
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=AudioServiceOutOfProcess",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-notifications",
      ],
    });
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
    await context.grantPermissions(["microphone", "camera"], { origin: "https://teams.microsoft.com" });
    const page = await context.newPage();
    return { browser, context, page };
  }

  async function closeTeams(runtime) {
    await runtime?.context.close().catch(() => undefined);
    await runtime?.browser.close().catch(() => undefined);
  }

  async function joinTeams(runtime, session, heartbeat, timeoutMs = lobbyTimeoutMs) {
    await prepareTeamsPage(runtime.page, session, teamsDisplayName);
    return waitForTeamsJoin(runtime.page, {
      sessionId: session.id,
      updateStatus: heartbeat.update,
      shouldStop,
      timeoutMs,
    });
  }

  async function reconnectTeams(current, session, heartbeat, sinkName, storageState) {
    await closeTeams(current);
    const deadline = Date.now() + reconnectTimeoutMs;
    let lastError;

    while (Date.now() < deadline) {
      let next;
      try {
        next = await launchTeams(sinkName, storageState);
        if (await joinTeams(next, session, heartbeat, Math.min(60_000, reconnectTimeoutMs))) return next;
        await closeTeams(next);
        return null;
      } catch (error) {
        lastError = error;
        await closeTeams(next);
        const code = errorCode(error);
        if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") throw error;
        await sleep(5_000);
      }
    }

    throw codedError(
      "TEAMS_RECOVERY_FAILED",
      `Teams connection could not be recovered: ${lastError instanceof Error ? lastError.message : "timeout"}`,
    );
  }

  async function confirmSomeoneElseIsPresent(page, timeoutMs = 30_000) {
    await clickIfVisible(page, [/^People$/i, /^Participants$/i, /Người tham gia/i]).catch(() => false);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await readTeamsPage(page);
      if (["REMOVED", "REJECTED", "MEETING_ENDED", "PAGE_CLOSED"].includes(snapshot.state)) return false;
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
        if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") throw error;
      }
      await closeTeams(runtime);
      runtime = null;
      await sleep(Math.min(rejoinAttemptMs, Math.max(0, deadline - Date.now())));
    }
    return null;
  }

  async function maybeRecoverSilentAudio({
    recorder,
    teamsRuntime,
    session,
    heartbeat,
    sink,
    storageState,
    participantCount,
    lastRecoveryAt,
  }) {
    const health = await recorderRuntime.audioHealth(recorder);
    if (!health) return { teamsRuntime, lastRecoveryAt };

    const now = Date.now();
    const noInitialSignal = health.lastSignalAt === null && now - health.startedAt >= audioInitialWarnMs;
    const staleSignal = health.lastSignalAt !== null && now - health.lastSignalAt >= audioSilenceWarnMs;
    if (!noInitialSignal && !staleSignal) return { teamsRuntime, lastRecoveryAt };

    if (!lastRecoveryAt || now - lastRecoveryAt >= 10 * 60_000) {
      console.warn(
        `[meeting-bot] session ${session.id} audio signal is silent; rms=${health.rms.toFixed(6)} peak=${health.peakRms.toFixed(6)}.`,
      );
      if (typeof participantCount === "number" && participantCount > 1) {
        await recorderRuntime.pause(recorder);
        const recovered = await reconnectTeams(
          teamsRuntime, session, heartbeat, sink.sinkName, storageState,
        );
        if (!recovered) throw codedError("TEAMS_RECOVERY_FAILED", "Teams audio route recovery stopped.");
        await recorderRuntime.resume(recorder);
        return { teamsRuntime: recovered, lastRecoveryAt: now };
      }
      return { teamsRuntime, lastRecoveryAt: now };
    }
    return { teamsRuntime, lastRecoveryAt };
  }

  async function requestContinuation(session) {
    return api(`/api/meeting/bot-sessions/${encodeURIComponent(session.id)}/continue`, {
      method: "POST",
      body: JSON.stringify({ runnerId }),
    }).catch(() => null);
  }

  async function runSession(session, storageState) {
    const heartbeat = createHeartbeat(session.id);
    let sink;
    let teamsRuntime;
    let recorder;
    let exitMessage = null;

    try {
      await heartbeat.update("JOINING");
      sink = await createPulseAudioSession(session.id);
      teamsRuntime = await launchTeams(sink.sinkName, storageState);
      if (!await joinTeams(teamsRuntime, session, heartbeat)) return;

      recorder = await recorderRuntime.launch(session, sink.sourceName, storageState);
      await heartbeat.update("CAPTURING", { meetingId: recorder.meetingId });

      const captureStartedAtMs = Date.now();
      let aloneState = initialAloneState();
      let reconnectingSince = null;
      let lastAudioRecoveryAt = null;

      while (true) {
        if (!recorderRuntime.isAlive(recorder)) {
          throw codedError("RECORDER_CRASHED", "Recorder browser crashed while the meeting was active.");
        }

        if (!teamsRuntime?.browser.isConnected() || teamsRuntime.page.isClosed()) {
          await recorderRuntime.pause(recorder);
          try {
            teamsRuntime = await reconnectTeams(
              teamsRuntime, session, heartbeat, sink.sinkName, storageState,
            );
          } catch (error) {
            const code = errorCode(error);
            if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") {
              exitMessage = error instanceof Error ? error.message : "The bot was removed from Teams.";
              break;
            }
            throw error;
          }
          if (!teamsRuntime) break;
          await recorderRuntime.resume(recorder);
          continue;
        }

        const snapshot = await readTeamsPage(teamsRuntime.page);
        if (snapshot.state === "REMOVED") {
          exitMessage = "The bot was removed from the Teams meeting.";
          break;
        }
        if (snapshot.state === "REJECTED") {
          exitMessage = "The bot was rejected from the Teams meeting.";
          break;
        }
        if (snapshot.state === "MEETING_ENDED") {
          await recorderRuntime.pause(recorder);
          let restarted;
          try {
            restarted = await waitForMeetingRestart(
              teamsRuntime, session, heartbeat, sink.sinkName, storageState,
            );
          } catch (error) {
            const code = errorCode(error);
            if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") {
              exitMessage = error instanceof Error ? error.message : "The bot was not admitted again.";
              break;
            }
            throw error;
          }
          teamsRuntime = restarted;
          if (!restarted) {
            exitMessage = "The Teams meeting ended.";
            break;
          }
          await recorderRuntime.resume(recorder);
          aloneState = initialAloneState();
          reconnectingSince = null;
          continue;
        }

        if (snapshot.state === "RECONNECTING") {
          reconnectingSince ??= Date.now();
          if (Date.now() - reconnectingSince >= 15_000) {
            await recorderRuntime.pause(recorder);
            try {
              teamsRuntime = await reconnectTeams(
                teamsRuntime, session, heartbeat, sink.sinkName, storageState,
              );
            } catch (error) {
              const code = errorCode(error);
              if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") {
                exitMessage = error instanceof Error ? error.message : "The bot was removed while reconnecting.";
                break;
              }
              throw error;
            }
            if (!teamsRuntime) break;
            await recorderRuntime.resume(recorder);
            reconnectingSince = null;
            continue;
          }
        } else {
          reconnectingSince = null;
        }

        if (await shouldStop(session.id)) {
          exitMessage = "The bot was stopped by the Meeting application.";
          break;
        }

        const nowMs = Date.now();
        if (isMaxDurationExceeded(captureStartedAtMs, nowMs, maxDurationMs)) {
          exitMessage = "The bot reached the maximum configured meeting duration.";
          break;
        }

        const participantCount = parseParticipantCount(snapshot.body);
        const aloneResult = nextAloneState(
          aloneState,
          isAloneFromCount(participantCount),
          nowMs,
          aloneTimeoutMs,
        );
        aloneState = { aloneSinceMs: aloneResult.aloneSinceMs };
        if (aloneResult.shouldEnd) {
          exitMessage = "The bot was alone in the meeting past the configured timeout.";
          break;
        }

        let audioRecovery;
        try {
          audioRecovery = await maybeRecoverSilentAudio({
            recorder,
            teamsRuntime,
            session,
            heartbeat,
            sink,
            storageState,
            participantCount,
            lastRecoveryAt: lastAudioRecoveryAt,
          });
        } catch (error) {
          const code = errorCode(error);
          if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") {
            exitMessage = error instanceof Error ? error.message : "The bot was removed during audio recovery.";
            break;
          }
          throw error;
        }
        teamsRuntime = audioRecovery.teamsRuntime;
        lastAudioRecoveryAt = audioRecovery.lastRecoveryAt;

        await heartbeat.update("CAPTURING", { meetingId: recorder.meetingId });
        await sleep(pollMs);
      }

      const recordedMs = Date.now() - captureStartedAtMs;
      await heartbeat.update("STOP_REQUESTED", {
        meetingId: recorder.meetingId,
        ...(exitMessage ? { errorMessage: exitMessage } : {}),
      });

      await closeTeams(teamsRuntime);
      teamsRuntime = null;
      await recorderRuntime.finish(recorder);
      const timedOut = await recorderRuntime.waitForProcessing(
        recorder, session, heartbeat, recordedMs,
      );
      await heartbeat.update("ENDED", {
        meetingId: recorder.meetingId,
        errorMessage: timedOut
          ? "Processing timed out; the meeting was force-completed with a placeholder result."
          : exitMessage ?? undefined,
      });
    } catch (error) {
      const code = errorCode(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedMeetingId = recorder?.meetingId || error?.meetingId;

      if (code === "TEAMS_JOIN_REJECTED" || code === "TEAMS_REMOVED") {
        await heartbeat.update("ENDED", { errorMessage }).catch(() => undefined);
      } else {
        await heartbeat.update("FAILED", {
          ...(failedMeetingId ? { meetingId: failedMeetingId } : {}),
          errorMessage,
        }).catch(() => undefined);

        if (["RECORDER_CRASHED", "TEAMS_RECOVERY_FAILED", "TEAMS_PAGE_CLOSED"].includes(code)) {
          await requestContinuation(session);
        }
      }
    } finally {
      heartbeat.stop();
      await recorderRuntime.dispose(recorder);
      await closeTeams(teamsRuntime);
      await sink?.dispose().catch(() => undefined);
    }
  }

  return { runSession, ACTIVE_STATUSES };
}
