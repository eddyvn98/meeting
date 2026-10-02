import { chromium } from "@playwright/test";
import { createPulseAudioSession } from "./meeting-bot-audio.mjs";
import { createSessionControl } from "./meeting-bot-control.mjs";
import { maybeRecoverSilentAudio } from "./meeting-bot-audio-watch.mjs";
import {
  initialAloneState,
  isAloneFromCount,
  isMaxDurationExceeded,
  nextAloneState,
  parseParticipantCount,
} from "./meeting-bot-lifecycle.mjs";
import {
  createTeamsRecovery,
  isIntentionalTeamsExit,
  isStopRejoinError,
} from "./meeting-bot-recovery.mjs";
import {
  clickIfVisible,
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
export function createBotSessionRunner(config) {
  const {
    api, emit, recorderRuntime, runnerId, teamsDisplayName,
    browserChannel, browserExecutable, headless, pollMs,
    lobbyTimeoutMs, reconnectTimeoutMs, rejoinWindowMs, rejoinAttemptMs,
    aloneTimeoutMs, initialAloneGraceMs, maxDurationMs, audioInitialWarnMs, audioSilenceWarnMs,
  } = config;
  const control = createSessionControl({ api, emit, runnerId });
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
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1000 },
    });
    for (const origin of [
      "https://teams.microsoft.com",
      "https://teams.live.com",
      "https://teams.cloud.microsoft",
    ]) {
      await context.grantPermissions(["microphone", "camera"], { origin }).catch(() => undefined);
    }
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
      shouldStop: control.shouldStop,
      timeoutMs,
    });
  }
  const recovery = createTeamsRecovery({
    launchTeams,
    closeTeams,
    joinTeams,
    reconnectTimeoutMs,
    rejoinWindowMs,
    rejoinAttemptMs,
  });
  async function requestContinuation(session) {
    return api(`/api/meeting/bot-sessions/${encodeURIComponent(session.id)}/continue`, {
      method: "POST",
      body: JSON.stringify({ runnerId }),
    }).catch(() => null);
  }
  async function runSession(session, storageState) {
    const heartbeat = control.createHeartbeat(session.id);
    let sink;
    let teamsRuntime;
    let recorder;
    let exitMessage = null;
    try {
      await heartbeat.update("JOINING");
      sink = await createPulseAudioSession(session.id);
      teamsRuntime = await launchTeams(sink.sinkName, storageState);
      if (!await joinTeams(teamsRuntime, session, heartbeat)) return;
      await clickIfVisible(
        teamsRuntime.page,
        [/^People$/i, /^Participants$/i, /Người tham gia/i],
      ).catch(() => false);
      recorder = await recorderRuntime.launch(session, sink.sourceName, storageState);
      await heartbeat.update("CAPTURING", { meetingId: recorder.meetingId });
      const captureStartedAtMs = Date.now();
      let aloneState = initialAloneState();
      let seenOtherParticipant = false;
      let reconnectingSince = null;
      let lastAudioRecoveryAt = null;
      while (true) {
        if (!recorderRuntime.isAlive(recorder)) {
          const error = new Error("Recorder browser crashed while the meeting was active.");
          error.code = "RECORDER_CRASHED";
          throw error;
        }
        if (!teamsRuntime?.browser.isConnected() || teamsRuntime.page.isClosed()) {
          await recorderRuntime.pause(recorder);
          const recovered = await recovery.reconnectOrSetExit(
            [teamsRuntime, session, heartbeat, sink.sinkName, storageState],
            "The bot was removed from Teams.",
          );
          teamsRuntime = recovered.runtime;
          if (recovered.exitMessage) { exitMessage = recovered.exitMessage; break; }
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
        if (snapshot.state === "LEFT" || snapshot.state === "MEETING_ENDED") {
          await recorderRuntime.pause(recorder);
          try {
            teamsRuntime = await recovery.waitForMeetingRestart(
              teamsRuntime, session, heartbeat, sink.sinkName, storageState,
            );
          } catch (error) {
            if (!isStopRejoinError(error)) throw error;
            exitMessage = error instanceof Error ? error.message : "The bot was not admitted again.";
            break;
          }
          if (!teamsRuntime) {
            exitMessage = snapshot.state === "LEFT"
              ? "Teams reported that the bot left the meeting."
              : "The Teams meeting ended.";
            break;
          }
          await recorderRuntime.resume(recorder);
          aloneState = initialAloneState();
          seenOtherParticipant = true;
          reconnectingSince = null;
          continue;
        }
        if (snapshot.state === "RECONNECTING") {
          reconnectingSince ??= Date.now();
          if (Date.now() - reconnectingSince >= 15_000) {
            await recorderRuntime.pause(recorder);
            const recovered = await recovery.reconnectOrSetExit(
              [teamsRuntime, session, heartbeat, sink.sinkName, storageState],
              "The bot was removed while reconnecting.",
            );
            teamsRuntime = recovered.runtime;
            if (recovered.exitMessage) { exitMessage = recovered.exitMessage; break; }
            if (!teamsRuntime) break;
            await recorderRuntime.resume(recorder);
            reconnectingSince = null;
            continue;
          }
        } else reconnectingSince = null;
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
        if (typeof participantCount === "number" && participantCount > 1) {
          seenOtherParticipant = true;
        }
        const initialGraceActive =
          !seenOtherParticipant &&
          nowMs - captureStartedAtMs < initialAloneGraceMs;
        const aloneResult = nextAloneState(
          aloneState,
          !initialGraceActive && isAloneFromCount(participantCount),
          nowMs,
          aloneTimeoutMs,
        );
        aloneState = { aloneSinceMs: aloneResult.aloneSinceMs };
        if (aloneResult.shouldEnd) {
          exitMessage = "The bot was alone in the meeting past the configured timeout.";
          break;
        }
        try {
          const audioRecovery = await maybeRecoverSilentAudio({
            recorderRuntime,
            reconnectTeams: recovery.reconnectTeams,
            recorder,
            teamsRuntime,
            session,
            heartbeat,
            sink,
            storageState,
            participantCount,
            lastRecoveryAt: lastAudioRecoveryAt,
            audioInitialWarnMs,
            audioSilenceWarnMs,
          });
          teamsRuntime = audioRecovery.teamsRuntime;
          lastAudioRecoveryAt = audioRecovery.lastRecoveryAt;
          if (!teamsRuntime) {
            exitMessage = "The bot was stopped while recovering the Teams audio route.";
            break;
          }
        } catch (error) {
          if (!isStopRejoinError(error)) throw error;
          exitMessage = error instanceof Error ? error.message : "The bot was removed during audio recovery.";
          break;
        }
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
      if (isIntentionalTeamsExit(error) && !recorder) {
        await heartbeat.update("ENDED", { errorMessage }).catch(() => undefined);
      } else {
        await heartbeat.update("FAILED", {
          ...(failedMeetingId ? { meetingId: failedMeetingId } : {}),
          errorMessage,
        }).catch(() => undefined);
        if ([
          "RECORDER_CRASHED",
          "RECORDER_SOURCE_ENDED",
          "TEAMS_RECOVERY_FAILED",
          "TEAMS_PAGE_CLOSED",
        ].includes(code)) {
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
