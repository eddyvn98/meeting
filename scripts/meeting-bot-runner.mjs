import { randomUUID } from "node:crypto";
import {
  getIdentityStorageState,
  getTeamsStorageState,
  resolveTeamsAuthMode,
} from "./meeting-bot-auth-state.mjs";
import { createCalendarSync, hasCalendarConfig } from "./meeting-bot-calendar.mjs";
import { computeProcessingTimeoutMs } from "./meeting-bot-lifecycle.mjs";
import { createMeetingRecorderRuntime } from "./meeting-bot-recorder.mjs";
import { cleanupStalePulseAudioModules } from "./meeting-bot-audio.mjs";
import { createBotSessionRunner } from "./meeting-bot-session.mjs";
import { pruneIdentityDebugArtifacts } from "./meeting-bot-identity-diagnostics.mjs";

const baseUrl = requiredEnv("MEETING_BOT_BASE_URL").replace(/\/$/, "");
const runnerToken = requiredEnv("MEETING_BOT_RUNNER_TOKEN");
const runnerId = process.env.MEETING_BOT_RUNNER_ID || `runner-${process.pid}-${randomUUID()}`;
const pollMs = positiveNumber(process.env.MEETING_BOT_POLL_MS, 3_000);
const graphSyncMs = Math.max(
  15_000,
  positiveNumber(
    process.env.MEETING_BOT_GRAPH_SYNC_MS || process.env.MEETING_BOT_CALENDAR_POLL_MS,
    60_000,
  ),
);
const schedulePollMs = positiveNumber(process.env.MEETING_BOT_SCHEDULE_POLL_MS, 15_000);
const configuredMaxConcurrency = Math.max(
  1,
  Math.floor(positiveNumber(process.env.MEETING_BOT_MAX_CONCURRENCY, 2)),
);
const teamsAuthMode = resolveTeamsAuthMode();
const maxConcurrency = teamsAuthMode === "authenticated" ? 1 : configuredMaxConcurrency;

const teamsDisplayName =
  process.env.MEETING_BOT_TEAMS_DISPLAY_NAME?.trim() || "Meeting STT Assistant";
const browserChannel = process.env.MEETING_BOT_BROWSER_CHANNEL || undefined;
const browserExecutable = process.env.MEETING_BOT_BROWSER_EXECUTABLE || undefined;
const headless = process.env.MEETING_BOT_HEADLESS !== "false";
const requireMediaOff = process.env.MEETING_BOT_REQUIRE_MEDIA_OFF !== "false";
let shuttingDown = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[meeting-bot] ${signal} received; stopping claims and finalizing active sessions.`);
  });
}

const recorderRuntime = createMeetingRecorderRuntime({
  baseUrl,
  runnerToken,
  runnerId,
  teamsDisplayName,
  browserChannel,
  browserExecutable,
  processingPollMs: positiveNumber(process.env.MEETING_BOT_PROCESSING_POLL_MS, 5_000),
  processingTimeoutMinMs: positiveNumber(
    process.env.MEETING_BOT_PROCESSING_TIMEOUT_MIN_MS,
    10 * 60_000,
  ),
  processingTimeoutMaxMs: positiveNumber(
    process.env.MEETING_BOT_PROCESSING_TIMEOUT_MAX_MS,
    90 * 60_000,
  ),
  processingTimeoutDefaultMs: positiveNumber(
    process.env.MEETING_BOT_PROCESSING_TIMEOUT_MS,
    45 * 60_000,
  ),
  computeProcessingTimeoutMs,
  headless,
});

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      "x-meeting-bot-token": runnerToken,
      "x-meeting-bot-runner-id": runnerId,
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Meeting bot API failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function emit(sessionId, status, extra = {}) {
  return api(`/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    body: JSON.stringify({ status, ...extra }),
  });
}

const sessionRunner = createBotSessionRunner({
  api,
  emit,
  recorderRuntime,
  runnerId,
  teamsDisplayName,
  browserChannel,
  browserExecutable,
  headless,
  requireMediaOff,
  pollMs,
  lobbyTimeoutMs: positiveNumber(process.env.MEETING_BOT_LOBBY_TIMEOUT_MS, 15 * 60_000),
  reconnectTimeoutMs: positiveNumber(process.env.MEETING_BOT_RECONNECT_TIMEOUT_MS, 2 * 60_000),
  rejoinWindowMs: nonNegativeNumber(process.env.MEETING_BOT_REJOIN_WINDOW_MS, 2 * 60_000),
  rejoinAttemptMs: positiveNumber(process.env.MEETING_BOT_REJOIN_ATTEMPT_MS, 30_000),
  aloneTimeoutMs: positiveNumber(process.env.MEETING_BOT_ALONE_TIMEOUT_MS, 5 * 60_000),
  initialAloneGraceMs: positiveNumber(
    process.env.MEETING_BOT_INITIAL_ALONE_GRACE_MS,
    15 * 60_000,
  ),
  maxDurationMs: positiveNumber(process.env.MEETING_BOT_MAX_DURATION_MS, 4 * 60 * 60_000),
  audioInitialWarnMs: positiveNumber(
    process.env.MEETING_BOT_AUDIO_INITIAL_SIGNAL_MS,
    60_000,
  ),
  audioSilenceWarnMs: positiveNumber(
    process.env.MEETING_BOT_AUDIO_SILENCE_MS,
    3 * 60_000,
  ),
  controlOutageGraceMs: nonNegativeNumber(
    process.env.MEETING_BOT_CONTROL_OUTAGE_GRACE_MS,
    60_000,
  ),
  shutdownFinalizeTimeoutMs: positiveNumber(
    process.env.MEETING_BOT_SHUTDOWN_FINALIZE_TIMEOUT_MS,
    45_000,
  ),
  controlOutageFinalizeTimeoutMs: positiveNumber(
    process.env.MEETING_BOT_CONTROL_OUTAGE_FINALIZE_TIMEOUT_MS,
    90_000,
  ),
  shouldShutdown: () => shuttingDown,
  identityStorageState: undefined,
});

async function main() {
  if (process.platform !== "linux") {
    throw new Error("The unattended meeting bot requires Linux with PulseAudio/PipeWire Pulse.");
  }

  if (!headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error(
      "MEETING_BOT_HEADLESS=false requires DISPLAY or WAYLAND_DISPLAY. Use headless mode for unattended Linux.",
    );
  }

  const prunedDebugArtifacts = await pruneIdentityDebugArtifacts().catch(() => 0);
  if (prunedDebugArtifacts > 0) {
    console.log(`[meeting-bot] pruned ${prunedDebugArtifacts} expired identity diagnostic screenshot(s).`);
  }

  const cleanedPulseModules = await cleanupStalePulseAudioModules();
  if (cleanedPulseModules > 0) {
    console.log(`[meeting-bot] cleaned ${cleanedPulseModules} stale PulseAudio module(s) from dead runners.`);
  }

  const teamsStorageState = await getTeamsStorageState();
  const identityStorageState = await getIdentityStorageState();
  sessionRunner.setIdentityStorageState(identityStorageState);
  console.log(`[meeting-bot] Teams join mode: ${teamsAuthMode}.`);
  console.log(
    `[meeting-bot] Outlook identity session: ${identityStorageState ? "available" : "unavailable"}.`,
  );
  if (teamsAuthMode === "authenticated" && configuredMaxConcurrency > 1) {
    console.log(
      "[meeting-bot] Authenticated mode currently uses one account, so concurrency is clamped to 1.",
    );
  }
  const calendarSync = hasCalendarConfig() ? createCalendarSync({ api }) : null;
  if (!calendarSync) {
    console.log("[meeting-bot] Microsoft Graph sync is disabled; internal schedules remain active.");
  }

  const active = new Map();
  let nextCalendarSync = 0;
  let nextScheduleDispatch = 0;
  let calendarSyncInFlight = null;

  while (!shuttingDown) {
    if (calendarSync && !calendarSyncInFlight && Date.now() >= nextCalendarSync) {
      nextCalendarSync = Date.now() + graphSyncMs;
      calendarSyncInFlight = calendarSync().finally(() => {
        calendarSyncInFlight = null;
      });
    }

    if (Date.now() >= nextScheduleDispatch) {
      await api("/api/meeting/bot-schedules/dispatch", { method: "POST" }).catch((error) => {
        console.error(
          "[meeting-bot] schedule dispatch failed:",
          error instanceof Error ? error.message : error,
        );
      });
      nextScheduleDispatch = Date.now() + schedulePollMs;
    }

    while (!shuttingDown && active.size < maxConcurrency) {
      let session;
      try {
        session = await api("/api/meeting/bot-sessions/claim", { method: "POST" });
      } catch (error) {
        console.error(
          "[meeting-bot] claim failed; runner will retry:",
          error instanceof Error ? error.message : error,
        );
        break;
      }

      if (!session || !sessionRunner.ACTIVE_STATUSES.has(session.status)) break;
      const run = sessionRunner
        .runSession(session, teamsStorageState)
        .catch((error) => {
          console.error(
            `[meeting-bot] session ${session.id} crashed outside lifecycle handling:`,
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => active.delete(session.id));
      active.set(session.id, run);
    }

    await sleep(pollMs);
  }

  if (calendarSyncInFlight) {
    await calendarSyncInFlight.catch(() => undefined);
  }
  if (active.size > 0) {
    console.log(`[meeting-bot] waiting for ${active.size} active session(s) to finalize.`);
    await Promise.allSettled([...active.values()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
