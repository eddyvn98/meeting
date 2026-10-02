# Microsoft Graph calendar integration

## Purpose

This integration lets the Meeting bot discover Outlook/Teams meetings automatically without a Teams custom app.

Flow:

```text
Outlook calendar
    -> Microsoft Graph (application permission)
    -> Meeting bot calendar sync
    -> CALENDAR bot session
    -> Teams Web browser bot
    -> lobby/admit
    -> record / STT / summary / minutes / action items
```

The existing internal scheduler remains independent. If Graph is disabled or temporarily fails, manually scheduled meetings continue to work.

## Microsoft Entra app

Create a **single-tenant** Microsoft Entra application for the background service.

The runner uses OAuth 2.0 client credentials, so there is no interactive user sign-in.

The integration needs the effective permission **Calendars.Read**. Choose one authorization model:

### Option A - simple tenant-wide application permission

For a quick internal test, add Microsoft Graph **Application** permission `Calendars.Read` to the Entra app and grant tenant admin consent.

This is simple, but the application permission is broad unless the tenant applies a supported mailbox access restriction.

### Option B - recommended production mailbox-scoped RBAC

Use **Exchange Online RBAC for Applications** to assign `Application Calendars.Read` only to the approved mailbox scope.

RBAC for Applications is independent from broad Entra application grants. If strict mailbox isolation is the goal, do not also leave an unscoped Entra `Calendars.Read` grant in place, because permission grants can combine.

Do not add `Calendars.ReadWrite` unless the product later needs to modify Outlook events.
Do not add `OnlineMeetings.Read.All` for this flow. The join URL is read from the Outlook event's `onlineMeeting.joinUrl`.

Microsoft documentation:

- Graph event / online meeting URL: https://learn.microsoft.com/en-us/graph/outlook-calendar-online-meetings
- Calendar/event permissions: https://learn.microsoft.com/en-us/graph/permissions-reference
- Calendar view: https://learn.microsoft.com/en-us/graph/api/user-list-calendarview
- Immutable Outlook IDs: https://learn.microsoft.com/en-us/graph/outlook-immutable-id

## Restrict the app to the intended mailbox

For production, scope the service principal to only the mailbox(es) that Meeting is allowed to read.

Microsoft's current Exchange Online mechanism for granular app-only mailbox access is **RBAC for Applications**.

Typical administrator flow:

1. Register the Entra service principal in Exchange Online with `New-ServicePrincipal`.
2. Create or choose a recipient management scope that contains only the approved mailbox(es).
3. Assign the role `Application Calendars.Read` to the service principal with that scope.
4. Validate the result with `Test-ServicePrincipalAuthorization`.

Official guide:

https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac

Do not combine a broad unscoped Entra calendar grant with a narrow RBAC assignment if the goal is strict mailbox isolation; use one deliberate authorization model and verify the resulting scope with `Test-ServicePrincipalAuthorization`.

## Configuration

Set these values on the **Linux bot runner**, not in browser code:

```env
MEETING_BOT_GRAPH_TENANT_ID=<tenant-id>
MEETING_BOT_GRAPH_CLIENT_ID=<application-client-id>
MEETING_BOT_GRAPH_CLIENT_SECRET=<client-secret>

# Email/UPN or Entra user id of the mailbox to read.
MEETING_BOT_GRAPH_USER_ID=user@company.com

# Optional when USER_ID is already an email/UPN.
# Required when USER_ID is a GUID so the Meeting app knows who owns generated meetings.
MEETING_BOT_GRAPH_OWNER_EMAIL=user@company.com

MEETING_BOT_GRAPH_SYNC_MS=60000
MEETING_BOT_GRAPH_LOOKBACK_MIN=30
MEETING_BOT_GRAPH_LOOKAHEAD_HOURS=48
```

If every `MEETING_BOT_GRAPH_*` credential value is blank, Graph sync is disabled and the internal scheduler continues to work.

If only part of the credential set is present, the runner fails fast with a configuration error rather than silently pretending Graph is disabled.

## Verify access before starting the bot

Run:

```bash
pnpm meeting:graph:check
```

A successful check prints:

- mailbox
- Meeting owner
- snapshot window
- number of Graph pages
- total calendar events
- Teams events
- eligible auto-join meetings

The check does **not** create bot sessions. It only verifies authentication and calendar reading.

Common failures:

- `401` / authentication error: wrong tenant, client id, secret, or expired secret.
- `403`: application permission/admin consent or Exchange mailbox scope is missing.
- mailbox not found: `MEETING_BOT_GRAPH_USER_ID` is wrong or the app is outside the allowed mailbox scope.

## Runtime synchronization

Start the normal runner:

```bash
pnpm meeting:bot
```

When Graph is configured, the same process performs two independent loops:

1. internal schedule dispatch
2. Outlook calendar synchronization

Graph sync defaults to every 60 seconds.

For every snapshot the client:

- requests calendar occurrences from 30 minutes in the past through 48 hours ahead
- requests UTC event times
- requests immutable Outlook event IDs
- follows every `@odata.nextLink` page
- uses `onlineMeeting.joinUrl` as the primary Teams URL
- keeps `onlineMeetingUrl` only as a legacy fallback
- ignores declined meetings
- removes cancelled/deleted/non-Teams meetings from the pending queue
- updates title/link changes
- treats a moved start time as a new occurrence and removes the old queued occurrence
- reconciles missing events so deleted calendar items do not leave stale bots behind

The Graph client refreshes its access token after a 401 and retries temporary 429/503 responses, respecting `Retry-After` when provided.

## Ownership

Calendar events belong to the configured mailbox owner, not necessarily the event organizer.

This matters when the configured user is merely an attendee. The previous implementation used `event.organizer`, which could incorrectly assign the resulting Meeting record to somebody else. The current sync uses `MEETING_BOT_GRAPH_OWNER_EMAIL` (or the mailbox UPN itself).

## Recurring Outlook meetings

Graph `calendarView` expands recurring meetings into occurrences within the synchronization window.

Each occurrence gets an independent source key composed from:

- configured mailbox
- immutable Graph event id
- occurrence start time

That allows one recurring series to produce independent bot joins while still making reschedules and deletions safe.

## No Teams custom app required

This Graph integration only reads Outlook calendar events and schedules the existing Teams Web browser participant.

A Teams custom app can be added later for:

- Teams tabs
- meeting side panel
- chat/bot commands
- notifications
- Teams-native navigation

That future app can reuse the same Meeting backend and does not require replacing this calendar synchronization flow.
