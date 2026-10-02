const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DEFAULT_LOOKBACK_MIN = 30;
const DEFAULT_LOOKAHEAD_HOURS = 48;

function email(value) {
  if (typeof value !== "string") return null;
  const clean = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function graphCalendarConfig(env = process.env) {
  const fields = {
    tenantId: env.MEETING_BOT_GRAPH_TENANT_ID?.trim(),
    clientId: env.MEETING_BOT_GRAPH_CLIENT_ID?.trim(),
    clientSecret: env.MEETING_BOT_GRAPH_CLIENT_SECRET?.trim(),
    userId: env.MEETING_BOT_GRAPH_USER_ID?.trim(),
  };
  const values = Object.values(fields);
  if (values.every((value) => !value)) return null;

  const missing = Object.entries(fields)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Microsoft Graph config is incomplete: missing ${missing.join(", ")}.`);
  }

  const ownerEmail = email(env.MEETING_BOT_GRAPH_OWNER_EMAIL) || email(fields.userId);
  if (!ownerEmail) {
    throw new Error(
      "MEETING_BOT_GRAPH_OWNER_EMAIL is required when MEETING_BOT_GRAPH_USER_ID is not an email/UPN.",
    );
  }

  return {
    ...fields,
    ownerEmail,
    mailboxKey: fields.userId.toLowerCase(),
    lookbackMin: positiveNumber(env.MEETING_BOT_GRAPH_LOOKBACK_MIN, DEFAULT_LOOKBACK_MIN),
    lookaheadHours: positiveNumber(env.MEETING_BOT_GRAPH_LOOKAHEAD_HOURS, DEFAULT_LOOKAHEAD_HOURS),
  };
}

export function hasCalendarConfig(env = process.env) {
  return graphCalendarConfig(env) !== null;
}

export function graphDateTimeToIso(value) {
  const raw = value?.dateTime;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const timeZone = typeof value?.timeZone === "string" ? value.timeZone.trim().toUpperCase() : "";
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const normalized = hasOffset ? raw : timeZone === "UTC" ? `${raw}Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function graphEventToSyncItem(event) {
  const scheduledAt = graphDateTimeToIso(event?.start);
  if (!event?.id || !scheduledAt) return null;

  return {
    eventId: String(event.id),
    meetingUrl: event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || null,
    title: typeof event.subject === "string" && event.subject.trim()
      ? event.subject.trim()
      : "Teams Meeting",
    scheduledAt,
    cancelled: event.isCancelled === true || event.isAllDay === true,
    declined: event.responseStatus?.response === "declined",
  };
}

export function createGraphCalendarClient({ env = process.env, fetchImpl = fetch } = {}) {
  const config = graphCalendarConfig(env);
  if (!config) throw new Error("Microsoft Graph calendar sync is not configured.");

  let accessToken = null;
  let expiresAt = 0;

  async function graphToken() {
    if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: GRAPH_SCOPE,
      grant_type: "client_credentials",
    });
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.access_token !== "string") {
      throw new Error(data.error_description || data.error || "Microsoft Graph authentication failed.");
    }

    accessToken = data.access_token;
    expiresAt = Date.now() + positiveNumber(data.expires_in, 3600) * 1000;
    return accessToken;
  }

  async function graphGet(url) {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${await graphToken()}`,
        Prefer: 'outlook.timezone="UTC", IdType="ImmutableId", odata.maxpagesize=100',
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || data.error_description || `Microsoft Graph request failed (${response.status}).`;
      throw new Error(message);
    }
    return data;
  }

  async function fetchSnapshot(nowMs = Date.now()) {
    const windowStart = new Date(nowMs - config.lookbackMin * 60_000);
    const windowEnd = new Date(nowMs + config.lookaheadHours * 60 * 60_000);
    const query = new URLSearchParams({
      startDateTime: windowStart.toISOString(),
      endDateTime: windowEnd.toISOString(),
      "$top": "100",
      "$select": [
        "id",
        "iCalUId",
        "subject",
        "start",
        "end",
        "isCancelled",
        "isAllDay",
        "isOnlineMeeting",
        "onlineMeeting",
        "onlineMeetingUrl",
        "responseStatus",
        "type",
        "lastModifiedDateTime",
      ].join(","),
    });

    let url = `${GRAPH_BASE}/users/${encodeURIComponent(config.userId)}/calendarView?${query}`;
    const events = [];
    let pages = 0;

    while (url) {
      const data = await graphGet(url);
      pages += 1;
      if (Array.isArray(data.value)) events.push(...data.value);
      url = typeof data["@odata.nextLink"] === "string" ? data["@odata.nextLink"] : null;
      if (pages > 100) throw new Error("Microsoft Graph calendar pagination exceeded 100 pages.");
    }

    return {
      mailboxKey: config.mailboxKey,
      ownerEmail: config.ownerEmail,
      userId: config.userId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      pages,
      events: events.map(graphEventToSyncItem).filter(Boolean),
      rawEventCount: events.length,
    };
  }

  return { config, fetchSnapshot };
}

export function createCalendarSync({ env = process.env, api, logger = console, fetchImpl = fetch }) {
  if (typeof api !== "function") throw new Error("Calendar sync requires the Meeting bot API client.");
  const client = createGraphCalendarClient({ env, fetchImpl });

  return async function runSync() {
    try {
      const snapshot = await client.fetchSnapshot();
      const result = await api("/api/meeting/bot-sessions/sync-calendar", {
        method: "POST",
        body: JSON.stringify({
          mailboxKey: snapshot.mailboxKey,
          ownerEmail: snapshot.ownerEmail,
          windowStart: snapshot.windowStart,
          windowEnd: snapshot.windowEnd,
          events: snapshot.events,
        }),
      });

      logger.log(
        `[meeting-bot] Graph calendar synced ${snapshot.rawEventCount} events across ${snapshot.pages} page(s): ` +
        `created=${result?.created || 0}, updated=${result?.updated || 0}, removed=${result?.removed || 0}, stop=${result?.stopRequested || 0}.`,
      );
      return result;
    } catch (error) {
      logger.error(
        "[meeting-bot] Microsoft Graph calendar sync failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  };
}
