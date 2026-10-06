import { describe, expect, it } from "vitest";
import {
  authStateModeIsPrivate,
  resolveTeamsAuthMode,
  resolveTeamsAuthStatePath,
} from "../../scripts/meeting-bot-auth-state.mjs";
import { isTeamsAuthUrl } from "../../scripts/meeting-bot-teams.mjs";

describe("meeting bot Teams authentication", () => {
  it("keeps anonymous mode as the backward-compatible default", () => {
    expect(resolveTeamsAuthMode({})).toBe("anonymous");
  });

  it("accepts authenticated mode and rejects unknown values", () => {
    expect(resolveTeamsAuthMode({ MEETING_BOT_TEAMS_AUTH_MODE: " authenticated " })).toBe("authenticated");
    expect(() => resolveTeamsAuthMode({ MEETING_BOT_TEAMS_AUTH_MODE: "graph-media" })).toThrow(
      /anonymous.*authenticated/i,
    );
  });

  it("uses an ignored local auth-state path by default", () => {
    expect(resolveTeamsAuthStatePath({}, "/srv/meeting")).toBe(
      "/srv/meeting/.meeting-bot/teams-auth.json",
    );
  });

  it("recognizes Microsoft sign-in hosts", () => {
    expect(isTeamsAuthUrl("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")).toBe(true);
    expect(isTeamsAuthUrl("https://login.live.com/")).toBe(true);
    expect(isTeamsAuthUrl("https://teams.microsoft.com/v2/")).toBe(false);
  });
  it("requires owner-only auth-state permissions", () => {
    expect(authStateModeIsPrivate(0o100600)).toBe(true);
    expect(authStateModeIsPrivate(0o100400)).toBe(true);
    expect(authStateModeIsPrivate(0o100640)).toBe(false);
    expect(authStateModeIsPrivate(0o100644)).toBe(false);
    expect(authStateModeIsPrivate(0o100660)).toBe(false);
  });
});
