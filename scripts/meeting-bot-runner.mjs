import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { createCalendarSync, hasCalendarConfig } from "./meeting-bot-calendar.mjs";
import { createPulseAudioSession } from "./meeting-bot-audio.mjs";
import {
  computeProcessingTimeoutMs,
  initialAloneState,
  isAloneFromCount,
  isMaxDurationExceeded,
  nextAloneState,
  parseParticipantCount,
} from "./meeting-bot-lifecycle.mjs";

const baseUrl = requiredEnv("MEETING_BOT_BASE_URL").replace(/\/$/, "");
const runnerToken = requiredEnv("MEETING_BOT_RUNNER_TOKEN");
const runnerId = process.env.MEETING_BOT_RUNNER_ID || `runner-${process.pid}-${randomUUID()}`;
const pollMs = Number(process.env.MEETING_BOT_POLL_MS || 3000);
const calendarPollMs = Number(process.env.MEETING_BOT_CALENDAR_POLL_MS || 15000);
const maxConcurrency = Math.max(1, Number(process.env.MEETING_BOT_MAX_CONCURRENCY || 2));
// How often the runner polls the meeting status while waiting for
// client-side post-processing (STT/diarization/insights) to finish after
// the Teams call has ended.
const processingPollMs = Number(process.env.MEETING_BOT_PROCESSING_POLL_MS || 5000);
// Bounds for computeProcessingTimeoutMs (see meeting-bot-lifecycle.mjs):
// how long the runner keeps the recorder browser open waiting for READY
// before forcing a mock-complete fallback.
const processingTimeoutMinMs = Number(process.env.MEETING_BOT_PROCESSING_TIMEOUT_MIN_MS || 10 * 60_000);
const processingTimeoutMaxMs = Number(process.env.MEETING_BOT_PROCESSING_TIMEOUT_MAX_MS || 90 * 60_000);
const processingTimeoutDefaultMs = Number(process.env.MEETING_BOT_PROCESSING_TIMEOUT_MS || 45 * 60_000);
// Leave the call after being the only participant left for this long,
// continuously (a headcount blip does not reset the streak's *timeout*,
// but a moment with someone else present does — see nextAloneState).
const aloneTimeoutMs = Number(process.env.MEETING_BOT_ALONE_TIMEOUT_MS || 5 * 60_000);
// Hard ceiling on total time in a call, regardless of activity.
const maxDurationMs = Number(process.env.MEETING_BOT_MAX_DURATION_MS || 4 * 60 * 60_000);
const browserChannel = process.env.MEETING_BOT_BROWSER_CHANNEL || undefined;
const browserExecutable = process.env.MEETING_BOT_BROWSER_EXECUTABLE || undefined;
const headless = process.env.MEETING_BOT_HEADLESS === "true";
const isInsecureLocalBaseUrl = baseUrl.startsWith("http://");
const teamsDisplayName = process.env.MEETING_BOT_TEAMS_DISPLAY_NAME?.trim() || "Meeting STT Assistant";
const nextAuthSecret = process.env.NEXTAUTH_SECRET;
const configuredBotSecret = process.env.MEETING_BOT_STT_NEXTAUTH_SECRET?.trim();
if (!nextAuthSecret?.trim()) throw new Error("NEXTAUTH_SECRET is required for the meeting bot STT session.");
const sttAuthSecret = nextAuthSecret;
if (configuredBotSecret && configuredBotSecret !== sttAuthSecret) {
  throw new Error("MEETING_BOT_STT_NEXTAUTH_SECRET must match NEXTAUTH_SECRET; the recorder uses the app's NextAuth secret.");
}
const ACTIVE_STATUSES = new Set(["REQUESTED", "CLAIMED", "JOINING", "LOBBY", "JOINED", "CAPTURING", "STOP_REQUESTED"]);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-meeting-bot-token": runnerToken,
      "x-meeting-bot-runner-id": runnerId,
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Meeting bot API failed (${response.status})`);
  return body;
}

async function emit(sessionId, status, extra = {}) {
  return api(`/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}/events`, {
    method: "POST",
    body: JSON.stringify({ status, ...extra }),
  });
}

function createSessionHeartbeat(sessionId) {
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

async function clickIfVisible(page, patterns) {
  for (const pattern of patterns) {
    const locator = page.getByRole("button", { name: pattern }).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return true;
    }
  }
  return false;
}

async function prepareTeamsPage(page, session) {
  await page.goto(session.meetingUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clickIfVisible(page, [/Continue on this browser/i, /Use web app/i, /Join on the web/i, /Tham gia cuộc họp từ trình duyệt này/i]);
  const nameInput = page.locator('input[placeholder*="name" i], input[aria-label*="name" i], input:not([type]), input[type="text"]').first();
  await nameInput.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(teamsDisplayName);
  await clickIfVisible(page, [/Join now/i, /Tham gia ngay/i, /^Join$/i]);
}

async function shouldStop(sessionId) {
  const session = await api(`/api/meeting/bot-sessions/${encodeURIComponent(sessionId)}`);
  return session?.status === "STOP_REQUESTED";
}

async function waitForTeamsJoin(page, sessionId, updateStatus) {
  const deadline = Date.now() + 120_000;
  let lobbyReported = false;
  while (Date.now() < deadline) {
    const body = await page.locator("body").innerText().catch(() => "");
    if (/waiting in the lobby|let you in|waiting for someone|sẽ có người cho bạn vào|đang chờ/i.test(body)) {
      if (!lobbyReported) { await updateStatus("LOBBY"); lobbyReported = true; }
    }
    if (await shouldStop(sessionId)) { await updateStatus("ENDED"); return false; }
    if (await page.getByRole("button", { name: /leave|end meeting|rời đi|rời khỏi cuộc họp|kết thúc cuộc họp/i }).first().isVisible().catch(() => false)) {
      await updateStatus("JOINED");
      return true;
    }
    await sleep(2000);
  }
  throw new Error(lobbyReported ? "The bot remained in the Teams lobby." : "Teams join timed out.");
}

async function launchSessionBrowser(storageState, sinkName) {
  if (!sttAuthSecret) throw new Error("NEXTAUTH_SECRET is required for STT access.");
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
  return { browser, context };
}

async function authenticateStt(context, session) {
  const now = Math.floor(Date.now() / 1000);
  const email = process.env.MEETING_BOT_STT_EMAIL?.trim() || session.ownerEmail;
  const token = await encode({
    token: {
      sub: `meeting-bot:${email}`, email, name: teamsDisplayName,
      userId: `meeting-bot:${email}`, displayName: teamsDisplayName,
      isDevSession: true, iat: now, exp: now + 12 * 60 * 60,
    },
    secret: sttAuthSecret,
  });
  const secure = baseUrl.startsWith("https://");
  await context.addCookies([{
    name: secure ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    value: token, url: baseUrl, secure, httpOnly: true, sameSite: "Lax",
  }]);
}

async function launchSttBrowser(storageState, sourceName, session) {
  const browser = await chromium.launch({
    ...(browserChannel ? { channel: browserChannel } : {}),
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    headless,
    env: { ...process.env, PULSE_SOURCE: sourceName },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-notifications",
      ...(isInsecureLocalBaseUrl ? [
        `--unsafely-treat-insecure-origin-as-secure=${baseUrl}`,
        "--use-fake-ui-for-media-stream",
      ] : []),
    ],
  });
  const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(["microphone"], { origin: baseUrl }).catch((error) => {
    if (!isInsecureLocalBaseUrl) throw error;
  });
  await authenticateStt(context, session);
  return { browser, context };
}

async function startRecorder(context, session, updateStatus) {
  const page = await context.newPage();
  let meetingId;
  try {
    await page.goto(`${baseUrl}/meeting?title=${encodeURIComponent(session.title)}&capture=bot-audio`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await clickIfVisible(page, [/Skip preload \(continue now\)/i]);
    const startButton = page.getByRole("button", { name: /Start Meeting/i }).last();
    await startButton.waitFor({ state: "visible", timeout: 60_000 }).catch(() => undefined);
    if (!(await startButton.isVisible().catch(() => false))) throw new Error("The Meeting page is not authenticated or the start control is unavailable.");
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/meeting") && response.request().method() === "POST", { timeout: 45_000 });
    await startButton.click();
    const data = await (await responsePromise).json();
    if (typeof data.id !== "string") throw new Error("Meeting recorder did not return a meeting id.");
    meetingId = data.id;
    await page.waitForURL(/\/meeting\/record/, { timeout: 30_000 });
    await updateStatus("CAPTURING", { meetingId });
    return { page, meetingId };
  } catch (error) {
    if (meetingId) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      wrapped.meetingId = meetingId;
      throw wrapped;
    }
    throw error;
  }
}

async function finishRecorder(page) {
  const endButton = page.getByRole("button", { name: /End Meeting/i }).first();
  if (!(await endButton.isVisible().catch(() => false))) {
    throw new Error("The recorder end control is unavailable.");
  }
  const finalizeResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/meeting\/[^/]+\/finalize$/.test(new URL(response.url()).pathname),
    { timeout: 120_000 },
  );
  await endButton.click();
  const response = await finalizeResponse;
  if (!response.ok()) throw new Error(`Recorder finalization failed (${response.status()}).`);
}

/**
 * After finalize succeeds, the meeting flips to PROCESSING and the real
 * post-processing (STT, diarization, insights/summary/minutes, title) runs
 * client-side in the same recorder page (RecordingScreen.tsx's processing
 * effect — it stays on /meeting/record, recorder.status becomes
 * "processing"; there is no navigation to wait for). Keep the STT/recorder
 * browser open and poll GET /api/meeting/{id} via the recorder page's own
 * authenticated request context (same NextAuth cookie authenticateStt set)
 * until the meeting reaches READY/FAILED, or the bounded timeout expires.
 * On timeout, force completion via the same guaranteed-completion fallback
 * the Processing screen itself calls, so the meeting never sits stuck in
 * PROCESSING with nothing left to drive it forward.
 *
 * Returns true when the wait timed out and mock-complete was forced;
 * false when the meeting reached a terminal state (READY or FAILED) on
 * its own.
 */
async function waitForProcessing(recorder, session, heartbeat, recordedMs) {
  const timeoutMs = computeProcessingTimeoutMs({
    recordedMs,
    minMs: processingTimeoutMinMs,
    maxMs: processingTimeoutMaxMs,
    defaultMs: processingTimeoutDefaultMs,
  });
  const deadline = Date.now() + timeoutMs;
  const requestContext = recorder.page.context().request;
  const meetingUrl = `${baseUrl}/api/meeting/${encodeURIComponent(recorder.meetingId)}`;

  while (Date.now() < deadline) {
    // Keep the bot session's lease alive while we wait; STOP_REQUESTED is
    // the correct status here (already an ACTIVE_STATUSES member and the
    // stale-lease sweep only requeues it after a heartbeat gap, which this
    // loop prevents).
    await heartbeat.update("STOP_REQUESTED", { meetingId: recorder.meetingId }).catch(() => undefined);
    try {
      const response = await requestContext.get(meetingUrl);
      if (response.ok()) {
        const data = await response.json();
        if (data?.status === "READY") return false;
        if (data?.status === "FAILED") return false;
      }
    } catch {
      // Transient network hiccup — keep polling until the deadline.
    }
    await sleep(processingPollMs);
  }

  console.log(`[meeting-bot] session ${session.id} processing wait timed out after ${timeoutMs}ms; forcing mock-complete.`);
  await requestContext.post(`${meetingUrl}/mock-complete`).catch(() => undefined);
  return true;
}

async function runSession(session, storageState) {
  const heartbeat = createSessionHeartbeat(session.id);
  let sink;
  let teamsRuntime;
  let sttRuntime;
  let recorder;
  try {
    await heartbeat.update("JOINING");
    sink = await createPulseAudioSession(session.id);
    teamsRuntime = await launchSessionBrowser(storageState, sink.sinkName);
    const teamsPage = await teamsRuntime.context.newPage();
    await prepareTeamsPage(teamsPage, session);
    if (!await waitForTeamsJoin(teamsPage, session.id, heartbeat.update)) return;
    sttRuntime = await launchSttBrowser(storageState, sink.sourceName, session);
    recorder = await startRecorder(sttRuntime.context, session, heartbeat.update);

    const captureStartedAtMs = Date.now();
    let aloneState = initialAloneState();
    while (true) {
      const body = await teamsPage.locator("body").innerText().catch(() => "");
      if (/meeting has ended|you've left the meeting|call ended|cuộc họp đã kết thúc|bạn đã rời khỏi cuộc họp|cuộc gọi đã kết thúc/i.test(body)) break;
      if (await shouldStop(session.id)) break;

      const nowMs = Date.now();
      if (isMaxDurationExceeded(captureStartedAtMs, nowMs, maxDurationMs)) {
        console.log(`[meeting-bot] session ${session.id} reached the max call duration; leaving.`);
        break;
      }
      const participantCount = parseParticipantCount(body);
      const aloneResult = nextAloneState(aloneState, isAloneFromCount(participantCount), nowMs, aloneTimeoutMs);
      aloneState = { aloneSinceMs: aloneResult.aloneSinceMs };
      if (aloneResult.shouldEnd) {
        console.log(`[meeting-bot] session ${session.id} has been alone in the call past the timeout; leaving.`);
        break;
      }

      await heartbeat.update("CAPTURING", { meetingId: recorder.meetingId });
      await sleep(pollMs);
    }
    const recordedMs = Date.now() - captureStartedAtMs;
    await heartbeat.update("STOP_REQUESTED", { meetingId: recorder.meetingId });

    // The Teams call itself is over (or we're leaving it); free that
    // browser's resources right away. Only the recorder/STT browser needs
    // to stay alive for finalize + the processing wait below.
    await teamsRuntime.context.close().catch(() => undefined);
    await teamsRuntime.browser.close().catch(() => undefined);
    teamsRuntime = null;

    await finishRecorder(recorder.page);
    const timedOut = await waitForProcessing(recorder, session, heartbeat, recordedMs);
    await heartbeat.update("ENDED", {
      meetingId: recorder.meetingId,
      ...(timedOut
        ? { errorMessage: "Processing timed out; the meeting was force-completed with a mock/placeholder result." }
        : {}),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failedMeetingId = recorder?.meetingId || error?.meetingId;
    await heartbeat.update("FAILED", {
      ...(failedMeetingId ? { meetingId: failedMeetingId } : {}),
      errorMessage,
    }).catch(() => undefined);
  } finally {
    heartbeat.stop();
    await recorder?.page.close().catch(() => undefined);
    await sttRuntime?.context.close().catch(() => undefined);
    await sttRuntime?.browser.close().catch(() => undefined);
    await teamsRuntime?.context.close().catch(() => undefined);
    await teamsRuntime?.browser.close().catch(() => undefined);
    await sink?.dispose().catch(() => undefined);
  }
}

async function main() {
  if (process.platform !== "linux") throw new Error("The unattended meeting bot now requires a Linux server with PulseAudio and parec.");
  const storageState = undefined;
  const calendarSync = hasCalendarConfig() ? createCalendarSync({ api }) : null;
  if (!calendarSync) console.log("Calendar discovery is disabled until Microsoft Graph credentials are configured.");
  const active = new Map();
  let nextCalendarSync = 0;
  while (true) {
    if (calendarSync && Date.now() >= nextCalendarSync) {
      await calendarSync();
      nextCalendarSync = Date.now() + calendarPollMs;
    }
    while (active.size < maxConcurrency) {
      const session = await api("/api/meeting/bot-sessions/claim", { method: "POST" });
      if (!session || !ACTIVE_STATUSES.has(session.status)) break;
      const run = runSession(session, storageState).finally(() => active.delete(session.id));
      active.set(session.id, run);
    }
    await sleep(pollMs);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
