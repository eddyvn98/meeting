import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";

export function resolveTeamsAuthMode(env = process.env) {
  const mode = (env.MEETING_BOT_TEAMS_AUTH_MODE || "anonymous").trim().toLowerCase();
  if (mode !== "anonymous" && mode !== "authenticated") {
    throw new Error(
      'MEETING_BOT_TEAMS_AUTH_MODE must be either "anonymous" or "authenticated".',
    );
  }
  return mode;
}

export function authStateModeIsPrivate(mode) {
  return (mode & 0o077) === 0;
}

async function assertPrivateAuthState(path) {
  if (process.platform === "win32") return;
  const info = await stat(path);
  if (!authStateModeIsPrivate(info.mode)) {
    const error = new Error(
      `Meeting bot auth state must not be readable or writable by group/other users: ${path}. Run chmod 600 on the file.`,
    );
    error.code = "TEAMS_AUTH_STATE_PERMISSIONS";
    throw error;
  }
}

export function resolveTeamsAuthStatePath(env = process.env, cwd = process.cwd()) {
  const configured = env.MEETING_BOT_TEAMS_AUTH_STATE?.trim();
  return resolve(cwd, configured || ".meeting-bot/teams-auth.json");
}

export async function getTeamsStorageState(env = process.env, cwd = process.cwd()) {
  if (resolveTeamsAuthMode(env) === "anonymous") return undefined;

  const authStatePath = resolveTeamsAuthStatePath(env, cwd);
  try {
    await access(authStatePath);
  } catch {
    const error = new Error(
      `Authenticated Teams mode needs ${authStatePath}. Run "pnpm meeting:bot:auth" first.`,
    );
    error.code = "TEAMS_AUTH_STATE_MISSING";
    throw error;
  }
  await assertPrivateAuthState(authStatePath);
  return authStatePath;
}


export function resolveIdentityAuthStatePath(env = process.env, cwd = process.cwd()) {
  const configured = env.MEETING_BOT_IDENTITY_AUTH_STATE?.trim();
  return resolve(cwd, configured || env.MEETING_BOT_TEAMS_AUTH_STATE?.trim() || ".meeting-bot/teams-auth.json");
}

export async function getIdentityStorageState(env = process.env, cwd = process.cwd()) {
  const authStatePath = resolveIdentityAuthStatePath(env, cwd);
  try {
    await access(authStatePath);
  } catch {
    return undefined;
  }
  await assertPrivateAuthState(authStatePath);
  return authStatePath;
}
