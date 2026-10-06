import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEBUG_ARTIFACTS = process.env.MEETING_BOT_DEBUG_ARTIFACTS === "true";
const DEBUG_DIR = resolve(process.env.MEETING_BOT_DEBUG_DIR?.trim() || ".meeting-bot-debug");

function cleanToken(value) {
  return String(value ?? "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function compactDetails(details) {
  return Object.entries(details || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}=${value.length}`;
      if (typeof value === "object") return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value).replace(/\s+/g, " ").slice(0, 240)}`;
    })
    .join(" ");
}

export function logIdentityDiagnostic(sessionId, source, code, details = {}, level = "log") {
  const suffix = compactDetails(details);
  const message =
    `[meeting-bot][identity] session=${cleanToken(sessionId)} source=${cleanToken(source)} code=${cleanToken(code)}` +
    (suffix ? ` ${suffix}` : "");
  const writer = console[level] || console.log;
  writer(message);
}

export async function captureIdentityScreenshot(page, sessionId, label) {
  if (!DEBUG_ARTIFACTS || !page || page.isClosed()) return null;
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = resolve(
      DEBUG_DIR,
      `${cleanToken(sessionId)}-${stamp}-${cleanToken(label)}.png`,
    );
    await page.screenshot({ path, fullPage: true });
    logIdentityDiagnostic(sessionId, "diagnostics", "SCREENSHOT_SAVED", { path });
    return path;
  } catch (error) {
    logIdentityDiagnostic(
      sessionId,
      "diagnostics",
      "SCREENSHOT_FAILED",
      { error: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    return null;
  }
}

export function identityDebugArtifactsEnabled() {
  return DEBUG_ARTIFACTS;
}
