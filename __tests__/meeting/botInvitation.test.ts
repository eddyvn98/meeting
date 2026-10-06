import { describe, expect, it } from "vitest";
import { parseTeamsInvitation } from "@/lib/meeting/bot/invitation";
import { normalizeTeamsMeetingUrl, teamsMeetingIdentity } from "@/lib/meeting/bot/teamsUrl";
import { nextMeetingScheduleAtOrAfter, nextMeetingScheduleRun } from "@/lib/meeting/bot/recurrence";

describe("Teams invitation parsing", () => {
  it("extracts a Teams link, title and English date/time", () => {
    const parsed = parseTeamsInvitation(`
Weekly Design Review
Monday, October 5, 2026
9:00 AM - 10:00 AM
Microsoft Teams
https://teams.microsoft.com/l/meetup-join/abc?context=test
`);
    expect(parsed.title).toBe("Weekly Design Review");
    expect(parsed.startLocal).toBe("2026-10-05T09:00");
    expect(parsed.meetingUrl).toContain("teams.microsoft.com");
  });

  it("prefers an Outlook Subject line over mail headers", () => {
    const parsed = parseTeamsInvitation(`
From: person@example.com
Sent: Friday, October 2, 2026
To: team@example.com
Subject: Weekly Coordination
When: Monday, October 5, 2026 9:00 AM - 10:00 AM
https://teams.microsoft.com/l/meetup-join/abc
`);
    expect(parsed.title).toBe("Weekly Coordination");
    expect(parsed.startLocal).toBe("2026-10-05T09:00");
  });

  it("supports day/month numeric invitations", () => {
    const parsed = parseTeamsInvitation(`
Client Review
05/10/2026 14:30 - 15:00
https://teams.microsoft.com/l/meetup-join/abc
`);
    expect(parsed.startLocal).toBe("2026-10-05T14:30");
  });

  it("leaves time empty when only a join link was pasted", () => {
    const parsed = parseTeamsInvitation("https://teams.microsoft.com/l/meetup-join/abc");
    expect(parsed.meetingUrl).toContain("teams.microsoft.com");
    expect(parsed.startLocal).toBeNull();
  });
});

describe("Teams URL normalization", () => {
  it("sorts query parameters so equivalent join links deduplicate", () => {
    const a = normalizeTeamsMeetingUrl(
      "https://teams.microsoft.com/l/meetup-join/abc?z=2&a=1#fragment",
    );
    const b = normalizeTeamsMeetingUrl(
      "https://teams.microsoft.com/l/meetup-join/abc?a=1&z=2",
    );
    expect(a).toBe(b);
  });

  it("uses host and decoded join path as the stable bot occurrence identity", () => {
    expect(teamsMeetingIdentity(
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=one",
    )).toBe(
      teamsMeetingIdentity(
        "https://teams.microsoft.com/l/meetup-join/19%3Ameeting_ABC%40thread.v2/0?context=two",
      ),
    );
    expect(teamsMeetingIdentity(
      "https://teams.microsoft.com/l/meetup-join/meeting-a",
    )).not.toBe(teamsMeetingIdentity(
      "https://teams.microsoft.com/l/meetup-join/meeting-b",
    ));
  });
});

describe("meeting schedule recurrence", () => {
  const start = new Date("2026-10-05T02:00:00.000Z");

  it("advances weekly and biweekly schedules", () => {
    expect(nextMeetingScheduleRun(start, "WEEKLY", start)?.toISOString()).toBe("2026-10-12T02:00:00.000Z");
    expect(nextMeetingScheduleRun(start, "BIWEEKLY", start)?.toISOString()).toBe("2026-10-19T02:00:00.000Z");
  });

  it("skips weekends for weekday schedules", () => {
    const friday = new Date("2026-10-02T02:00:00.000Z");
    expect(nextMeetingScheduleRun(friday, "WEEKDAYS", friday)?.toISOString()).toBe("2026-10-05T02:00:00.000Z");
  });

  it("keeps weekday recurrence on the local calendar day", () => {
    const fridaySixAmVietnam = new Date("2026-10-01T23:00:00.000Z");
    expect(
      nextMeetingScheduleRun(
        fridaySixAmVietnam,
        "WEEKDAYS",
        fridaySixAmVietnam,
        -420,
      )?.toISOString(),
    ).toBe("2026-10-04T23:00:00.000Z");
  });

  it("advances an old recurring schedule to the next future occurrence", () => {
    const old = new Date("2026-09-07T02:00:00.000Z");
    const from = new Date("2026-10-02T03:00:00.000Z");
    expect(nextMeetingScheduleAtOrAfter(old, "WEEKLY", from)?.toISOString()).toBe("2026-10-05T02:00:00.000Z");
    expect(nextMeetingScheduleAtOrAfter(old, "NONE", from)).toBeNull();
  });

  it("keeps the original day anchor for monthly schedules", () => {
    const jan31 = new Date("2026-01-31T02:00:00.000Z");
    const feb = nextMeetingScheduleRun(jan31, "MONTHLY", jan31)!;
    expect(feb.toISOString()).toBe("2026-02-28T02:00:00.000Z");
    expect(nextMeetingScheduleRun(jan31, "MONTHLY", feb)?.toISOString()).toBe("2026-03-31T02:00:00.000Z");
  });
});
