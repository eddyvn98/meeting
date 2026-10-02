/**
 * lib/meeting/notifyEmail.ts
 *
 * Optional email copy of a bell notification, sent through Microsoft Graph
 * (`POST /users/{sender}/sendMail`) with an app-only token. It is OFF unless
 * every MEETING_NOTIFY_* variable below is set, and the Azure app needs the
 * `Mail.Send` APPLICATION permission (ideally scoped to the sender mailbox
 * with an Exchange application access policy). Never throws.
 */

const GRAPH_TOKEN_URL = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

interface EmailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
}

export function emailConfig(env = process.env): EmailConfig | null {
  const { MEETING_NOTIFY_GRAPH_TENANT_ID: tenantId, MEETING_NOTIFY_GRAPH_CLIENT_ID: clientId, MEETING_NOTIFY_GRAPH_CLIENT_SECRET: clientSecret, MEETING_NOTIFY_SENDER: sender } = env;
  return tenantId && clientId && clientSecret && sender ? { tenantId, clientId, clientSecret, sender } : null;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface NotificationEmail {
  to: string;
  subject: string;
  /** Plain text, escaped here. */
  text: string;
  link: string;
}

/** Returns true when Graph accepted the message. */
export async function sendNotificationEmail(mail: NotificationEmail): Promise<boolean> {
  const config = emailConfig();
  if (!config) return false;
  try {
    const tokenRes = await fetch(GRAPH_TOKEN_URL(config.tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    });
    const token = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
    if (!tokenRes.ok || !token?.access_token) return false;

    const html = `<p>${escapeHtml(mail.text).replace(/\n/g, "<br>")}</p><p><a href="${escapeHtml(mail.link)}">Open Meeting</a></p>`;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: { subject: mail.subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: mail.to } }] },
        saveToSentItems: false,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
