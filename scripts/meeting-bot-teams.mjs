import { detectTeamsPageState } from "./meeting-bot-lifecycle.mjs";

export function isTeamsAuthUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return [
      "login.microsoftonline.com",
      "login.live.com",
      "account.live.com",
    ].includes(host);
  } catch {
    return false;
  }
}

export function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function errorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : null;
}

export async function clickIfVisible(page, patterns) {
  for (const pattern of patterns) {
    const locator = page.getByRole("button", { name: pattern }).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click();
      return true;
    }
  }
  return false;
}

export async function prepareTeamsPage(
  page,
  session,
  displayName,
  { authenticated = false } = {},
) {
  if (page.isClosed()) throw codedError("TEAMS_PAGE_CLOSED", "Teams page is closed.");
  await page.goto(session.meetingUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  if (isTeamsAuthUrl(page.url())) {
    throw codedError(
      "TEAMS_AUTH_REQUIRED",
      'The saved Microsoft/Teams session is missing or expired. Run "pnpm meeting:bot:auth" again.',
    );
  }
  await clickIfVisible(page, [
    /Continue on this browser/i,
    /Use web app/i,
    /Join on the web/i,
    /Tham gia cuộc họp từ trình duyệt này/i,
  ]);

  const nameInput = page.locator(
    'input[placeholder*="name" i], input[aria-label*="name" i], input:not([type]), input[type="text"]',
  ).first();
  const joinButton = page.getByRole("button", {
    name: /Join now|Tham gia ngay|^Join$|^Rejoin$|Tham gia lại/i,
  }).first();

  if (authenticated) {
    await Promise.race([
      nameInput.waitFor({ state: "visible", timeout: 15_000 }),
      joinButton.waitFor({ state: "visible", timeout: 15_000 }),
    ]).catch(() => undefined);

    if (isTeamsAuthUrl(page.url()) || await nameInput.isVisible().catch(() => false)) {
      throw codedError(
        "TEAMS_AUTH_REQUIRED",
        'Teams did not recognize the saved account session. Run "pnpm meeting:bot:auth" again.',
      );
    }
  } else {
    await nameInput.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
    if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(displayName);
  }

  await clickIfVisible(page, [/Join now/i, /Tham gia ngay/i, /^Join$/i, /^Rejoin$/i, /Tham gia lại/i]);
}

export async function teamsJoined(page) {
  if (page.isClosed()) return false;
  return page.getByRole("button", {
    name: /leave|end meeting|rời đi|rời khỏi cuộc họp|kết thúc cuộc họp/i,
  }).first().isVisible().catch(() => false);
}

export async function readTeamsPage(page) {
  if (page.isClosed()) return { state: "PAGE_CLOSED", body: "" };
  if (isTeamsAuthUrl(page.url())) return { state: "AUTH_REQUIRED", body: "" };
  const body = await page.locator("body").innerText().catch(() => "");
  const state = detectTeamsPageState(body);
  if (state) return { state, body };
  if (await teamsJoined(page)) return { state: "JOINED", body };
  return { state: "UNKNOWN", body };
}

export async function waitForTeamsJoin(page, {
  sessionId,
  updateStatus,
  shouldStop,
  timeoutMs = 15 * 60_000,
  pollMs = 2_000,
  reportLobby = true,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lobbyReported = false;

  while (Date.now() < deadline) {
    if (page.isClosed()) throw codedError("TEAMS_PAGE_CLOSED", "Teams page closed while joining.");

    const snapshot = await readTeamsPage(page);
    if (snapshot.state === "REJECTED") {
      throw codedError("TEAMS_JOIN_REJECTED", "The bot was rejected from the Teams lobby.");
    }
    if (snapshot.state === "REMOVED") {
      throw codedError("TEAMS_REMOVED", "The bot was removed from the Teams meeting.");
    }
    if (snapshot.state === "AUTH_REQUIRED") {
      throw codedError(
        "TEAMS_AUTH_REQUIRED",
        'The saved Microsoft/Teams session is missing or expired. Run "pnpm meeting:bot:auth" again.',
      );
    }
    if (snapshot.state === "ACCESS_DENIED") {
      throw codedError("TEAMS_ACCESS_DENIED", "Teams policy or permissions do not allow this bot to join.");
    }
    if (snapshot.state === "INVALID_LINK") {
      throw codedError("TEAMS_INVALID_LINK", "The Teams meeting link is invalid, expired, or unavailable.");
    }
    if (snapshot.state === "LOBBY" && reportLobby && !lobbyReported) {
      if (updateStatus) await updateStatus("LOBBY");
      lobbyReported = true;
    }

    if (shouldStop && sessionId && await shouldStop(sessionId)) {
      if (updateStatus) await updateStatus("ENDED");
      return false;
    }

    if (snapshot.state === "JOINED") {
      if (updateStatus) await updateStatus("JOINED");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw codedError(
    lobbyReported ? "TEAMS_LOBBY_TIMEOUT" : "TEAMS_JOIN_TIMEOUT",
    lobbyReported ? "The bot remained in the Teams lobby past the allowed wait." : "Teams join timed out.",
  );
}
