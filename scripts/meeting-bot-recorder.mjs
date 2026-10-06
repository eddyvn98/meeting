import { chromium } from "@playwright/test";
import { clickIfVisible, codedError } from "./meeting-bot-teams.mjs";

export function createMeetingRecorderRuntime({
  baseUrl,
  runnerToken,
  runnerId,
  teamsDisplayName,
  browserChannel,
  browserExecutable,
  processingPollMs,
  processingTimeoutMinMs,
  processingTimeoutMaxMs,
  processingTimeoutDefaultMs,
  computeProcessingTimeoutMs,
  headless = true,
}) {
  const isInsecureLocalBaseUrl = baseUrl.startsWith("http://");

  async function authenticate(context, session) {
    const response = await fetch(`${baseUrl}/api/meeting/bot-sessions/stt-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-meeting-bot-token": runnerToken,
        "x-meeting-bot-runner-id": runnerId,
      },
      body: JSON.stringify({ sessionId: session.id }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.token !== "string" || typeof data.cookieName !== "string") {
      throw new Error(data.error || `Failed to issue recorder session token (${response.status}).`);
    }
    const secure = baseUrl.startsWith("https://");
    await context.addCookies([{
      name: data.cookieName,
      value: data.token,
      url: baseUrl,
      secure,
      httpOnly: true,
      sameSite: "Lax",
    }]);
  }

  async function launch(session, sourceName, storageState) {
    const browser = await chromium.launch({
      ...(browserChannel ? { channel: browserChannel } : {}),
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      headless,
      env: { ...process.env, PULSE_SOURCE: sourceName },
      args: [
        ...(process.env.MEETING_BOT_DISABLE_CHROMIUM_SANDBOX === "true" ? ["--no-sandbox"] : []),
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-notifications",
        ...(isInsecureLocalBaseUrl ? [
          `--unsafely-treat-insecure-origin-as-secure=${baseUrl}`,
          "--use-fake-ui-for-media-stream",
        ] : []),
      ],
    });
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1440, height: 1000 },
    });
    await context.grantPermissions(["microphone"], { origin: baseUrl }).catch((error) => {
      if (!isInsecureLocalBaseUrl) throw error;
    });
    await authenticate(context, session);

    const page = await context.newPage();
    let meetingId;
    try {
      await page.goto(
        `${baseUrl}/meeting?title=${encodeURIComponent(session.title)}&capture=bot-audio`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
      await clickIfVisible(page, [/Skip preload \(continue now\)/i]);
      const startButton = page.getByRole("button", { name: /Start Meeting/i }).last();
      await startButton.waitFor({ state: "visible", timeout: 60_000 }).catch(() => undefined);
      if (!(await startButton.isVisible().catch(() => false))) {
        throw new Error("The Meeting page is not authenticated or the start control is unavailable.");
      }

      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith("/api/meeting") && response.request().method() === "POST",
        { timeout: 45_000 },
      );
      await startButton.click();
      const data = await (await responsePromise).json();
      if (typeof data.id !== "string") throw new Error("Meeting recorder did not return a meeting id.");
      meetingId = data.id;
      await page.waitForURL(/\/meeting\/record/, { timeout: 30_000 });
      return { browser, context, page, meetingId };
    } catch (error) {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      if (meetingId && error && typeof error === "object") error.meetingId = meetingId;
      throw error;
    }
  }

  function isAlive(recorder) {
    return Boolean(
      recorder &&
      !recorder.page.isClosed() &&
      recorder.browser.isConnected(),
    );
  }

  async function pause(recorder) {
    if (!isAlive(recorder)) throw codedError("RECORDER_CRASHED", "Recorder browser is not available.");
    const paused = await clickIfVisible(recorder.page, [/Pause recording/i]);
    if (!paused) {
      const label = await recorder.page.locator("body").innerText().catch(() => "");
      if (!/Paused/i.test(label)) throw codedError("RECORDER_CONTROL_FAILED", "Recorder could not be paused.");
    }
  }

  async function resume(recorder) {
    if (!isAlive(recorder)) throw codedError("RECORDER_CRASHED", "Recorder browser is not available.");
    const resumed = await clickIfVisible(recorder.page, [/Resume recording/i]);
    if (!resumed) {
      const label = await recorder.page.locator("body").innerText().catch(() => "");
      if (/Paused/i.test(label)) throw codedError("RECORDER_CONTROL_FAILED", "Recorder could not be resumed.");
    }
  }

  async function audioHealth(recorder) {
    if (!isAlive(recorder)) throw codedError("RECORDER_CRASHED", "Recorder browser is not available.");
    return recorder.page.evaluate(() => {
      const value = window.__meetingBotAudioHealth;
      return value ? { ...value } : null;
    }).catch(() => null);
  }

  async function finish(
    recorder,
    { timeoutMs = 11 * 60_000, skipFullAudio = false } = {},
  ) {
    if (!isAlive(recorder)) throw codedError("RECORDER_CRASHED", "Recorder browser closed before finalization.");
    await recorder.page.evaluate((skip) => {
      window.__meetingBotSkipFullAudio = skip === true;
    }, skipFullAudio).catch(() => undefined);
    const endButton = recorder.page.getByRole("button", { name: /End Meeting/i }).first();
    if (!(await endButton.isVisible().catch(() => false))) {
      throw new Error("The recorder end control is unavailable.");
    }
    const finalizeResponse = recorder.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/meeting\/[^/]+\/finalize$/.test(new URL(response.url()).pathname),
      { timeout: timeoutMs },
    );
    await endButton.click();
    const response = await finalizeResponse;
    if (!response.ok()) throw new Error(`Recorder finalization failed (${response.status()}).`);
  }

  async function waitForProcessing(
    recorder,
    session,
    heartbeat,
    recordedMs,
    { shouldShutdown = () => false } = {},
  ) {
    const timeoutMs = computeProcessingTimeoutMs({
      recordedMs,
      minMs: processingTimeoutMinMs,
      maxMs: processingTimeoutMaxMs,
      defaultMs: processingTimeoutDefaultMs,
    });
    const deadline = Date.now() + timeoutMs;
    const requestContext = recorder.page.context().request;
    const meetingUrl = `${baseUrl}/api/meeting/${encodeURIComponent(recorder.meetingId)}`;

    let readySeenAt = null;
    while (Date.now() < deadline) {
      if (shouldShutdown()) return "SHUTDOWN";
      await heartbeat.update("STOP_REQUESTED", { meetingId: recorder.meetingId }).catch(() => undefined);
      try {
        const response = await requestContext.get(meetingUrl);
        if (response.ok()) {
          const data = await response.json();
          if (data?.status === "FAILED") return "FAILED";
          if (data?.status === "READY") {
            readySeenAt ??= Date.now();
            const diarizationStatus = await recorder.page.evaluate(() => {
              return window.__meetingDiarizationStatus ?? null;
            }).catch(() => null);
            if (diarizationStatus === "done" || diarizationStatus === "failed") return "READY";
            if (diarizationStatus === null && Date.now() - readySeenAt >= 10_000) return "READY";
          }
        }
      } catch {
        // Keep polling through temporary app/network interruptions.
      }
      await new Promise((resolve) => setTimeout(resolve, processingPollMs));
    }

    if (readySeenAt !== null) {
      console.log(
        `[meeting-bot] session ${session.id} diarization did not finish before the processing timeout; keeping the usable READY transcript.`,
      );
      return "READY";
    }

    console.error(
      `[meeting-bot] session ${session.id} processing timed out after ${timeoutMs}ms; preserving audio and marking the run retryable.`,
    );
    return "TIMEOUT";
  }

  async function dispose(recorder) {
    await recorder?.page.close().catch(() => undefined);
    await recorder?.context.close().catch(() => undefined);
    await recorder?.browser.close().catch(() => undefined);
  }

  return {
    launch,
    isAlive,
    pause,
    resume,
    audioHealth,
    finish,
    waitForProcessing,
    dispose,
  };
}
