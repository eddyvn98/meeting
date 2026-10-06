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
  ensurePeoplePanelOpen,
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
const IDENTITY_RETRY_COOLDOWN_MS = 2 * 60_000;
const MAX_SPEAKER_OBSERVATIONS = 5_000;
export function createBotSessionRunner(config) {
  let identityStorageState = config.identityStorageState;
  const {
    api, emit, recorderRuntime, runnerId, teamsDisplayName,
    browserChannel, browserExecutable, headless, requireMediaOff, pollMs,
    lobbyTimeoutMs, reconnectTimeoutMs, rejoinWindowMs, rejoinAttemptMs,
    aloneTimeoutMs, initialAloneGraceMs, maxDurationMs, audioInitialWarnMs, audioSilenceWarnMs,
    controlOutageGraceMs, shouldShutdown = () => false,
  } = config;
  const control = createSessionControl({ api, emit, runnerId, controlOutageGraceMs });

  function setIdentityStorageState(value) {
    identityStorageState = value || undefined;
  }

  async function launchIdentityRuntime(storageState) {
    if (!storageState) return null;
    const browser = await chromium.launch({
      ...(browserChannel ? { channel: browserChannel } : {}),
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      headless,
      args: [
        ...(process.env.MEETING_BOT_DISABLE_CHROMIUM_SANDBOX === "true" ? ["--no-sandbox"] : []),
        "--disable-dev-shm-usage",
        "--disable-notifications",
      ],
    });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1000 },
    });
    return { browser, context };
  }

  async function closeIdentityRuntime(runtime) {
    await runtime?.context.close().catch(() => undefined);
    await runtime?.browser.close().catch(() => undefined);
  }
  async function launchTeams(sinkName, storageState) {
    const browser = await chromium.launch({
      ...(browserChannel ? { channel: browserChannel } : {}),
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      headless,
      env: { ...process.env, PULSE_SINK: sinkName },
      args: [
        ...(process.env.MEETING_BOT_DISABLE_CHROMIUM_SANDBOX === "true" ? ["--no-sandbox"] : []),
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=AudioServiceOutOfProcess",
        "--disable-notifications",
      ],
    });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    return { browser, context, page, authenticated: Boolean(storageState) };
  }
  async function closeTeams(runtime) {
    await runtime?.context.close().catch(() => undefined);
    await runtime?.browser.close().catch(() => undefined);
  }
  async function joinTeams(runtime, session, heartbeat, timeoutMs = lobbyTimeoutMs) {
    await prepareTeamsPage(runtime.page, session, teamsDisplayName, {
      authenticated: runtime.authenticated,
      requireMediaOff,
    });
    const joined = await waitForTeamsJoin(runtime.page, {
      sessionId: session.id,
      updateStatus: heartbeat.update,
      shouldStop: control.shouldStop,
      timeoutMs,
    });
    if (joined) {
      await ensurePeoplePanelOpen(runtime.page).catch(() => false);
    }
    return joined;
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
    let identityRuntime;
    let recorder;
    let exitMessage = null;
    try {
      await heartbeat.update("JOINING");
      sink = await createPulseAudioSession(session.id);
      teamsRuntime = await launchTeams(sink.sinkName, storageState);
      if (!await joinTeams(teamsRuntime, session, heartbeat)) return;
      const peopleOpened = await ensurePeoplePanelOpen(teamsRuntime.page).catch(() => false);
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
      const presentAttendeeEmails = new Set(
        Array.isArray(session.presentAttendeeEmails)
          ? session.presentAttendeeEmails.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
          : [],
      );
      logIdentityDiagnostic(session.id, "session", "INITIAL_STATE", {
        authenticated: teamsRuntime.authenticated,
        existingInviteeEmails: attendeeEmails.size,
        existingPresentEmails: presentAttendeeEmails.size,
      });
      const speakerObservations = [];
      let nextRosterPersistAt = 0;
      let nextIdentityProbeAt = 0;
      let identityProbeAttempts = 0;
      let identityWarningIssued = false;
      let identityDirty = false;
      let nextOutlookProbeAt = 0;
      const participantProbeState = new Map();

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
            inviteeEmails: attendeeEmails.size,
            presentEmails: presentAttendeeEmails.size,
          });
        } else {
          logIdentityDiagnostic(session.id, source, "NO_NEW_EMAILS", {
            totalEmails: attendeeEmails.size,
          });
        }
      };

      const mergePresentAttendeeEmails = (emails, source = "teams") => {
        const before = presentAttendeeEmails.size;
        for (const value of emails || []) {
          const email = typeof value === "string" ? value.trim().toLowerCase() : "";
          if (email) presentAttendeeEmails.add(email);
        }
        const added = presentAttendeeEmails.size - before;
        if (added > 0) {
          identityDirty = true;
          logIdentityDiagnostic(session.id, source, "PRESENT_EMAILS_MERGED", {
            added,
            totalPresentEmails: presentAttendeeEmails.size,
          });
        }
      };

      const outlookContext = async () => {
        if (teamsRuntime?.authenticated) return teamsRuntime.context;
        if (!identityStorageState) {
          logIdentityDiagnostic(
            session.id,
            "outlook",
            "IDENTITY_SESSION_UNAVAILABLE",
            { joinMode: "anonymous" },
            "warn",
          );
          return null;
        }
        if (!identityRuntime) {
          identityRuntime = await launchIdentityRuntime(identityStorageState).catch((error) => {
            logIdentityDiagnostic(session.id, "outlook", "IDENTITY_BROWSER_LAUNCH_FAILED", {
              error: error instanceof Error ? error.message : String(error),
            }, "warn");
            return null;
          });
        }
        return identityRuntime?.context ?? null;
      };

      const probeOutlookInvitees = async (reason) => {
        const context = await outlookContext();
        if (!context) return [];
        logIdentityDiagnostic(session.id, "outlook", "INVITEE_PROBE_TRIGGERED", { reason });
        const emails = await readOutlookMeetingAttendeeEmails(context, session).catch((error) => {
          logIdentityDiagnostic(session.id, "outlook", "INVITEE_PROBE_FAILED", {
            reason,
            error: error instanceof Error ? error.message : String(error),
          }, "warn");
          return [];
        });
        mergeAttendeeEmails(emails, "outlook");
        return emails;
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

          const probeNow = Date.now();
          const newKeys = new Set(newParticipantNames.map((name) => name.trim().toLocaleLowerCase()));
          const probeCandidates = roster.participantNames
            .map((name, index) => {
              const key = name.trim().toLocaleLowerCase();
              const state = participantProbeState.get(key) ?? { lastProbedAt: 0, resolved: false };
              return { name, key, index, ...state };
            })
            .filter((item) =>
              !item.resolved &&
              (item.lastProbedAt === 0 || probeNow - item.lastProbedAt >= IDENTITY_RETRY_COOLDOWN_MS)
            )
            .sort((a, b) => {
              const aNew = newKeys.has(a.key) ? 0 : 1;
              const bNew = newKeys.has(b.key) ? 0 : 1;
              if (aNew !== bNew) return aNew - bNew;
              if (a.lastProbedAt !== b.lastProbedAt) return a.lastProbedAt - b.lastProbedAt;
              return a.index - b.index;
            });

          const teamsEmails = await readTeamsParticipantEmails(teamsRuntime.page, {
            participantNames: probeCandidates.map((item) => item.name),
            maxProfiles: 6,
            sessionId: session.id,
            onParticipantProbed(name, { foundEmail }) {
              const key = name.trim().toLocaleLowerCase();
              participantProbeState.set(key, {
                lastProbedAt: Date.now(),
                resolved: Boolean(foundEmail),
              });
            },
          }).catch((error) => {
            logIdentityDiagnostic(session.id, "teams", "PROBE_CALL_FAILED", {
              error: error instanceof Error ? error.message : String(error),
            }, "warn");
            return [];
          });
          mergePresentAttendeeEmails(teamsEmails, "teams");

          if (
            presentAttendeeEmails.size === 0 &&
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
                totalPresentEmails: presentAttendeeEmails.size,
                note: "recording/STT continues; automatic shared-room access is withheld until a Teams identity is verified",
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
        presentAttendeeEmails: [...presentAttendeeEmails.values()],
        speakerObservations: [...speakerObservations],
      });

      await probeOutlookInvitees("capture-start");
      nextOutlookProbeAt = Date.now() + 5 * 60_000;

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
        if (shouldShutdown()) {
          exitMessage = "The bot runner is shutting down gracefully.";
          break;
        }
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
        if (snapshot.state === "AUTH_REQUIRED") {
          throw Object.assign(
            new Error("The saved Microsoft/Teams session expired during capture."),
            { code: "TEAMS_AUTH_REQUIRED" },
          );
        }
        if (snapshot.state === "ACCESS_DENIED") {
          throw Object.assign(
            new Error("Teams access was denied during capture."),
            { code: "TEAMS_ACCESS_DENIED" },
          );
        }
        if (snapshot.state === "INVALID_LINK") {
          throw Object.assign(
            new Error("Teams reported that the active meeting link is invalid or unavailable."),
            { code: "TEAMS_INVALID_LINK" },
          );
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
        const periodicOutlookProbe = nowMs >= nextOutlookProbeAt;
        if (periodicOutlookProbe) {
          await probeOutlookInvitees("periodic");
          nextOutlookProbeAt = nowMs + 5 * 60_000;
        }
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
              inviteeEmails: attendeeEmails.size,
              presentEmails: presentAttendeeEmails.size,
            });
          }
          identityDirty = false;
        }
        await sleep(pollMs);
      }
      const recordedMs = Date.now() - captureStartedAtMs;
      await probeOutlookInvitees("meeting-end");
      await sampleRoster({ probeIdentities: true }).catch((error) => {
        logIdentityDiagnostic(session.id, "session", "FINAL_IDENTITY_PROBE_FAILED", {
          error: error instanceof Error ? error.message : String(error),
        }, "warn");
      });
      logIdentityDiagnostic(session.id, "session", "FINAL_STATE", {
        participants: rosterNames.size,
        attendeeEmails: attendeeEmails.size,
        presentAttendeeEmails: presentAttendeeEmails.size,
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
      const processingOutcome = await recorderRuntime.waitForProcessing(
        recorder, session, heartbeat, recordedMs,
      );
      if (processingOutcome === "TIMEOUT") {
        await heartbeat.update("FAILED", {
          meetingId: recorder.meetingId,
          errorMessage: "Processing timed out. The recording was preserved and can be retried.",
        });
      } else if (processingOutcome === "FAILED") {
        await heartbeat.update("FAILED", {
          meetingId: recorder.meetingId,
          errorMessage: "Meeting transcription or processing failed. The recording was preserved for retry.",
        });
      } else {
        await heartbeat.update("ENDED", {
          meetingId: recorder.meetingId,
          errorMessage: exitMessage ?? undefined,
        });
      }
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
      await closeIdentityRuntime(identityRuntime);
      await sink?.dispose().catch(() => undefined);
    }
  }
  return { runSession, ACTIVE_STATUSES, setIdentityStorageState };
}
