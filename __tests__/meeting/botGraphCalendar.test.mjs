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
  MEETING_BOT_GRAPH_USER_ID: "owner@example.com",
};

describe("Microsoft Graph calendar helpers", () => {
  it("uses the mailbox email as Meeting owner by default", () => {
    const config = graphCalendarConfig(env);
    expect(config?.ownerEmail).toBe("owner@example.com");
    expect(config?.lookbackMin).toBe(30);
    expect(config?.lookaheadHours).toBe(48);
  });

  it("requires an explicit owner when Graph user id is an opaque id", () => {
    expect(() => graphCalendarConfig({
      ...env,
      MEETING_BOT_GRAPH_USER_ID: "7d9c2b51-opaque-guid",
    })).toThrow(/OWNER_EMAIL/);
  });

  it("normalizes Graph UTC dateTimeTimeZone values", () => {
    expect(graphDateTimeToIso({
      dateTime: "2026-10-05T09:00:00.0000000",
      timeZone: "UTC",
    })).toBe("2026-10-05T09:00:00.000Z");
  });

  it("prefers onlineMeeting.joinUrl and marks declined events", () => {
    const item = graphEventToSyncItem({
      id: "event-1",
      subject: "Weekly Review",
      start: { dateTime: "2026-10-05T02:00:00", timeZone: "UTC" },
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
      onlineMeetingUrl: "https://teams.microsoft.com/legacy",
      responseStatus: { response: "declined" },
    });
    expect(item).toMatchObject({
      eventId: "event-1",
      title: "Weekly Review",
      meetingUrl: "https://teams.microsoft.com/l/meetup-join/abc",
      declined: true,
    });
  });
});

describe("Microsoft Graph calendar snapshot", () => {
  it("follows pagination and requests UTC immutable event ids", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("login.microsoftonline.com")) {
        return new Response(JSON.stringify({
          access_token: "token",
          expires_in: 3600,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(url).includes("page=2")) {
        return new Response(JSON.stringify({
          value: [{
            id: "event-2",
            subject: "Second",
            start: { dateTime: "2026-10-05T04:00:00", timeZone: "UTC" },
            onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/second" },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        value: [{
          id: "event-1",
          subject: "First",
          start: { dateTime: "2026-10-05T03:00:00", timeZone: "UTC" },
          onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/first" },
        }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/owner/calendarView?page=2",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const client = createGraphCalendarClient({ env, fetchImpl });
    const snapshot = await client.fetchSnapshot(Date.parse("2026-10-05T02:30:00Z"));

    expect(snapshot.pages).toBe(2);
    expect(snapshot.rawEventCount).toBe(2);
    expect(snapshot.events).toHaveLength(2);

    const graphCalls = calls.filter((call) => call.url.includes("graph.microsoft.com"));
    expect(graphCalls).toHaveLength(2);
    expect(graphCalls[0].init.headers.Prefer).toContain('outlook.timezone="UTC"');
    expect(graphCalls[0].init.headers.Prefer).toContain('IdType="ImmutableId"');
  });
});
