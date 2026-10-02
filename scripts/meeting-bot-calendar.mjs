const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export function hasCalendarConfig(env = process.env) {
  return Boolean(env.MEETING_BOT_GRAPH_TENANT_ID && env.MEETING_BOT_GRAPH_CLIENT_ID && env.MEETING_BOT_GRAPH_CLIENT_SECRET && env.MEETING_BOT_GRAPH_USER_ID);
}

export function createCalendarSync({ env = process.env, api, logger = console }) {
  let accessToken = null;
  let expiresAt = 0;

  async function graphToken() {
    if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
    const body = new URLSearchParams({
      client_id: env.MEETING_BOT_GRAPH_CLIENT_ID,
      client_secret: env.MEETING_BOT_GRAPH_CLIENT_SECRET,
      scope: GRAPH_SCOPE,
      grant_type: "client_credentials",
    });
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env.MEETING_BOT_GRAPH_TENANT_ID)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.access_token !== "string") throw new Error(data.error_description || "Microsoft Graph authentication failed.");
    accessToken = data.access_token;
    expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return accessToken;
  }

  async function graphGet(url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${await graphToken()}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Microsoft Graph request failed (${response.status}).`);
    return data;
  }

  async function sync() {
    const start = new Date(Date.now() - 5 * 60_000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const query = new URLSearchParams({
      startDateTime: start,
      endDateTime: end,
      "$top": "100",
      "$select": "id,subject,start,organizer,isCancelled,onlineMeeting,onlineMeetingUrl",
    });
    const data = await graphGet(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MEETING_BOT_GRAPH_USER_ID)}/calendarView?${query}`);
    let discovered = 0;
    for (const event of Array.isArray(data.value) ? data.value : []) {
      if (event.isCancelled) continue;
      const joinUrl = event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;
      const ownerEmail = event.organizer?.emailAddress?.address;
      if (!joinUrl || !ownerEmail || !event.id) continue;
      await api("/api/meeting/bot-sessions/discover", {
        method: "POST",
        body: JSON.stringify({
          meetingUrl: joinUrl,
          title: event.subject || "Teams Meeting",
          ownerEmail,
          sourceKey: event.id,
          scheduledAt: event.start?.dateTime,
        }),
      });
      discovered += 1;
    }
    return discovered;
  }

  return async function runSync() {
    try {
      return await sync();
    } catch (error) {
      logger.error(error instanceof Error ? error.message : error);
      return 0;
    }
  };
}
