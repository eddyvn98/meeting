import { describe, expect, it, vi } from "vitest";
import {
  createGraphCalendarClient,
  graphCalendarConfig,
  graphDateTimeToIso,
  graphEventToSyncItem,
} from "../../scripts/meeting-bot-calendar.mjs";

const env = {
  MEETING_BOT_GRAPH_TENANT_ID: "tenant",
  MEETING_BOT_GRAPH_CLIENT_ID: "client",
  MEETING_BOT_GRAPH_CLIENT_SECRET: "secret",
  MEETING_BOT_GRAPH_USER_ID: "meetingbot@example.com",
};

describe("Microsoft Graph bot mailbox helpers", () => {
  it("uses the mailbox domain as the default organizer allowlist", () => {
    const config = graphCalendarConfig(env);
    expect(config?.botEmail).toBe("meetingbot@example.com");
    expect(config?.allowedOrganizerDomains).toEqual(["example.com"]);
    expect(config?.lookbackMin).toBe(30);
    expect(config?.lookaheadHours).toBe(48);
  });

  it("requires BOT_EMAIL when Graph user id is an opaque id", () => {
    expect(() => graphCalendarConfig({
      ...env,
      MEETING_BOT_GRAPH_USER_ID: "7d9c2b51-opaque-guid",
    })).toThrow(/BOT_EMAIL/);
  });

  it("normalizes Graph UTC dateTimeTimeZone values", () => {
    expect(graphDateTimeToIso({
      dateTime: "2026-10-05T09:00:00.0000000",
      timeZone: "UTC",
    })).toBe("2026-10-05T09:00:00.000Z");
  });

  it("rejects offset-less non-UTC wall clocks instead of using runner local time", () => {
    expect(graphDateTimeToIso({
      dateTime: "2026-10-05T09:00:00",
      timeZone: "Pacific Standard Time",
    })).toBeNull();
  });

  it("accepts an invited Teams meeting from an allowed organizer", () => {
    const config = graphCalendarConfig(env);
    const item = graphEventToSyncItem({
      id: "event-1",
      subject: "Weekly Review",
      start: { dateTime: "2026-10-05T02:00:00", timeZone: "UTC" },
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
      organizer: { emailAddress: { address: "alice@example.com" } },
      attendees: [
        { emailAddress: { address: "meetingbot@example.com" } },
        { emailAddress: { address: "bob@example.com" } },
        { emailAddress: { address: "BOB@example.com" } },
      ],
      isOrganizer: false,
      responseStatus: { response: "notResponded" },
    }, config);
    expect(item).toMatchObject({
      ownerEmail: "alice@example.com",
      attendeeEmails: ["bob@example.com"],
      organizerAllowed: true,
      invited: true,
      meetingUrl: "https://teams.microsoft.com/l/meetup-join/abc",
    });
  });

  it("blocks an external organizer by default", () => {
    const config = graphCalendarConfig(env);
    const item = graphEventToSyncItem({
      id: "event-2",
      subject: "External",
      start: { dateTime: "2026-10-05T03:00:00", timeZone: "UTC" },
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/external" },
      organizer: { emailAddress: { address: "attacker@outside.test" } },
      attendees: [{ emailAddress: { address: "meetingbot@example.com" } }],
      isOrganizer: false,
    }, config);
    expect(item).toMatchObject({
      ownerEmail: null,
      organizerAllowed: false,
      invited: true,
    });
  });
});

describe("Microsoft Graph calendar snapshot", () => {
  it("retries a transient Graph network failure", async () => {
    let graphAttempts = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes("login.microsoftonline.com")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      graphAttempts += 1;
      if (graphAttempts === 1) throw new Error("temporary network failure");
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createGraphCalendarClient({ env, fetchImpl });
    const snapshot = await client.fetchSnapshot(Date.parse("2026-10-05T02:30:00Z"));
    expect(snapshot.events).toEqual([]);
    expect(graphAttempts).toBe(2);
  });

  it("follows pagination and requests bot-invite fields", async () => {
    const calls = [];
    const event = (id, title) => ({
      id,
      subject: title,
      start: { dateTime: "2026-10-05T03:00:00", timeZone: "UTC" },
      onlineMeeting: { joinUrl: `https://teams.microsoft.com/l/meetup-join/${id}` },
      organizer: { emailAddress: { address: "alice@example.com" } },
      attendees: [{ emailAddress: { address: "meetingbot@example.com" } }],
      isOrganizer: false,
    });
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("login.microsoftonline.com")) {
        return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(url).includes("page=2")) {
        return new Response(JSON.stringify({ value: [event("event-2", "Second")] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        value: [event("event-1", "First")],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/owner/calendarView?page=2",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const client = createGraphCalendarClient({ env, fetchImpl });
    const snapshot = await client.fetchSnapshot(Date.parse("2026-10-05T02:30:00Z"));

    expect(snapshot.pages).toBe(2);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events.every((event) => event.invited && event.organizerAllowed)).toBe(true);

    const graphCalls = calls.filter((call) => call.url.includes("graph.microsoft.com"));
    expect(graphCalls[0].init.headers.Prefer).toContain('outlook.timezone="UTC"');
    expect(graphCalls[0].url).toContain("attendees");
    expect(graphCalls[0].url).toContain("organizer");
    expect(graphCalls[0].url).toContain("isOrganizer");
  });
});
