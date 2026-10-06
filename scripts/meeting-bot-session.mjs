import { chromium } from "@playwright/test";
import { createPulseAudioSession } from "./meeting-bot-audio.mjs";
import { createSessionControl } from "./meeting-bot-control.mjs";
import { maybeRecoverSilentAudio } from "./meeting-bot-audio-watch.mjs";
import { readTeamsRosterSnapshot } from "./meeting-bot-roster.mjs";
import {
  readOutlookMeetingAttendeeEmails,
  readTeamsParticipantEmails,
} from "./meeting-bot-participant-identities.mjs";
import { logIdentityDiagnostic } from "./meeting-bot-identity-diagnostics.mjs";
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
const ROSTER_PERSIST_MS = 30_000;
const IDENTITY_PROBE_MS = 60_000;
const MAX_SPEAKER_OBSERVATIONS = 5_000;
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
    return { browser, context, page, authenticated: Boolean(storageState) };
  }
  async function closeTeams(runtime) {
    await runtime?.context.close().catch(() => undefined);
    await runtime?.browser.close().catch(() => undefined);
  }
  async function joinTeams(runtime, session, heartbeat, timeoutMs = lobbyTimeoutMs) {
    await prepareTeamsPage(runtime.page, session, teamsDisplayName, { authenticated: runtime.authenticated });
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
      const peopleOpened = await clickIfVisible(
        teamsRuntime.page,
        [/^People$/i, /^Participants$/i, /Người tham gia/i],
      ).catch(() => false);
      logIdentityDiagnostic(
        session.id,
        "teams",
        peopleOpened ? "PEOPLE_PANEL_OPENED" : "PEOPLE_PANEL_OPEN_FAILED",
        { authenticated: teamsRuntime.authenticated },
        peopleOpened ? "log" : "warn",
      );
      recorder = await recorderRuntime.launch(session, sink.sourceName);
      await heartbeat.update("CAPTURING", { meetingId: recorder.meetingId });
      const captureStartedAtMs = Date.now();
      const rosterNames = new Map();
      const attendeeEmails = new Set(
        Array.isArray(session.attendeeEmails)
          ? session.attendeeEmails.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
          : [],
      );
      logIdentityDiagnostic(session.id, "session", "INITIAL_STATE", {
        authenticated: teamsRuntime.authenticated,
        existingEmails: attendeeEmails.size,
      });
      const speakerObservations = [];
      let nextRosterPersistAt = 0;
      let nextIdentityProbeAt = 0;
      let identityProbeAttempts = 0;
      let identityWarningIssued = false;
      let identityDirty = false;

      const mergeAttendeeEmails = (emails, source = "unknown") => {
        const before = attendeeEmails.size;
        for (const value of emails || []) {
          const email = typeof value === "string" ? value.trim().toLowerCase() : "";
          if (email) attendeeEmails.add(email);
        }
        const added = attendeeEmails.size - before;
        if (added > 0) {
          identityDirty = true;
          logIdentityDiagnostic(session.id, source, "EMAILS_MERGED", {
            added,
            totalEmails: attendeeEmails.size,
          });
        } else {
          logIdentityDiagnostic(session.id, source, "NO_NEW_EMAILS", {
            totalEmails: attendeeEmails.size,
          });
        }
      };

      const sampleRoster = async ({ probeIdentities = false } = {}) => {
        const roster = await readTeamsRosterSnapshot(teamsRuntime.page, {
          selfDisplayName: teamsDisplayName,
        });
        const newParticipantNames = [];
        for (const name of roster.participantNames) {
          const key = name.trim().toLocaleLowerCase();
          if (key && !rosterNames.has(key)) {
            rosterNames.set(key, name.trim());
            newParticipantNames.push(name.trim());
          }
        }

        if (newParticipantNames.length > 0) {
          logIdentityDiagnostic(session.id, "teams", "NEW_PARTICIPANTS_OBSERVED", {
            added: newParticipantNames.length,
            seenParticipants: rosterNames.size,
          });
        }

        const shouldProbeIdentities =
          (probeIdentities || newParticipantNames.length > 0) &&
          rosterNames.size > 0;

        if (shouldProbeIdentities) {
          identityProbeAttempts += 1;

          const teamsEmails = await readTeamsParticipantEmails(teamsRuntime.page, {
            participantNames: roster.participantNames,
            maxProfiles: 6,
            sessionId: session.id,
          }).catch((error) => {
            logIdentityDiagnostic(session.id, "teams", "PROBE_CALL_FAILED", {
              error: error instanceof Error ? error.message : String(error),
            }, "warn");
            return [];
          });
          mergeAttendeeEmails(teamsEmails, "teams");

          // Authenticated mode can reuse the same Microsoft browser session in
          // a second tab. Outlook is an identity resolver only: it may resolve
          // email addresses for names already observed in Teams, never grant
          // access to invitees who have not actually appeared in the meeting.
          if (teamsRuntime.authenticated) {
            const outlookEmails = await readOutlookMeetingAttendeeEmails(
              teamsRuntime.context,
              session,
              { participantNames: [...rosterNames.values()] },
            ).catch((error) => {
              logIdentityDiagnostic(session.id, "outlook", "FALLBACK_CALL_FAILED", {
                error: error instanceof Error ? error.message : String(error),
              }, "warn");
              return [];
            });
            mergeAttendeeEmails(outlookEmails, "outlook");
          }

          if (
            teamsRuntime.authenticated &&
            attendeeEmails.size === 0 &&
            identityProbeAttempts >= 3 &&
            !identityWarningIssued
          ) {
            identityWarningIssued = true;
            logIdentityDiagnostic(
              session.id,
              "session",
              "IDENTITY_DEGRADED",
              {
                attempts: identityProbeAttempts,
                participants: rosterNames.size,
                totalEmails: attendeeEmails.size,
                note: "recording/STT continues; automatic shared-room access may be incomplete",
              },
              "warn",
            );
          }
        }

        if (roster.activeSpeakerNames.length > 0) {
          speakerObservations.push({
            atMs: Math.max(0, Date.now() - captureStartedAtMs),
            names: roster.activeSpeakerNames,
          });
          if (speakerObservations.length > MAX_SPEAKER_OBSERVATIONS) {
            speakerObservations.splice(0, speakerObservations.length - MAX_SPEAKER_OBSERVATIONS);
          }
        }

        return { newParticipantNames, currentParticipantNames: roster.participantNames };
      };
      const rosterPayload = () => ({
        participantNames: [...rosterNames.values()],
        attendeeEmails: [...attendeeEmails.values()],
        speakerObservations: [...speakerObservations],
      });

      await sampleRoster({ probeIdentities: true }).catch((error) => {
        logIdentityDiagnostic(session.id, "session", "INITIAL_IDENTITY_PROBE_FAILED", {
          error: error instanceof Error ? error.message : String(error),
        }, "warn");
      });
      nextIdentityProbeAt = Date.now() + IDENTITY_PROBE_MS;
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
        if (await control.shouldStop(session.id)) {
          exitMessage = "The bot was stopped by the Meeting application.";
          break;
        }
        const nowMs = Date.now();
        const periodicIdentityProbe = nowMs >= nextIdentityProbeAt;
        await sampleRoster({ probeIdentities: periodicIdentityProbe }).catch((error) => {
          logIdentityDiagnostic(session.id, "session", "IDENTITY_PROBE_FAILED", {
            error: error instanceof Error ? error.message : String(error),
          }, "warn");
        });
        if (periodicIdentityProbe) nextIdentityProbeAt = nowMs + IDENTITY_PROBE_MS;
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
        const persistRoster = nowMs >= nextRosterPersistAt || identityDirty;
        const persistingIdentityChange = identityDirty;
        if (persistingIdentityChange) {
          logIdentityDiagnostic(session.id, "session", "PERSIST_REQUESTED", {
            totalEmails: attendeeEmails.size,
          });
        }
        await heartbeat.update("CAPTURING", {
          meetingId: recorder.meetingId,
          ...(persistRoster ? rosterPayload() : {}),
        });
        if (persistRoster) {
          nextRosterPersistAt = nowMs + ROSTER_PERSIST_MS;
          if (persistingIdentityChange) {
            logIdentityDiagnostic(session.id, "session", "PERSIST_CONFIRMED", {
              totalEmails: attendeeEmails.size,
            });
          }
          identityDirty = false;
        }
        await sleep(pollMs);
      }
      const recordedMs = Date.now() - captureStartedAtMs;
      await sampleRoster({ probeIdentities: true }).catch((error) => {
        logIdentityDiagnostic(session.id, "session", "FINAL_IDENTITY_PROBE_FAILED", {
          error: error instanceof Error ? error.message : String(error),
        }, "warn");
      });
      logIdentityDiagnostic(session.id, "session", "FINAL_STATE", {
        participants: rosterNames.size,
        attendeeEmails: attendeeEmails.size,
        probes: identityProbeAttempts,
      });
      await heartbeat.update("STOP_REQUESTED", {
        meetingId: recorder.meetingId,
        ...rosterPayload(),
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
