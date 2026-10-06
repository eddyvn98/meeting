# Optional Microsoft Graph dedicated bot-mailbox integration

Microsoft Graph is optional. The Playwright runner can also collect attendee emails directly from Teams profile/contact cards and, in authenticated mode, Outlook Web Calendar. Use Graph only when administrator-approved calendar access is available or desired.

## Intended workflow

The production flow is:

```text
Employee creates a Teams meeting
    -> invites meetingbot@company.com
    -> Exchange places the invitation in the bot mailbox calendar
    -> Microsoft Graph reads only that mailbox
    -> Meeting verifies the organizer is allowed
    -> one CALENDAR bot session is queued
    -> at start time the Teams Web bot joins
    -> a human participant admits it from the lobby
    -> recording / STT / summary / minutes / action items
```

The bot mailbox is an **invite inbox and calendar**, not the owner of meeting results.

The organizer is stored as the administrative `ownerEmail`, but the meeting content is a **shared room for the calendar occurrence**. Every signed-in attendee whose email is present on the Graph event gets viewer access to the same live transcript and the same post-meeting Overview, Transcript and Minutes. See `docs/shared-teams-meeting-room.md`.

## Shared mailbox

Use a dedicated Exchange Online shared mailbox, for example:

```text
meetingbot@company.com
```

Users add this address as an attendee when they want the bot to join.

The Graph service reads the shared mailbox's primary calendar through:

```text
GET /users/meetingbot@company.com/calendarView
```

The current browser bot does not sign in to Teams as this mailbox. It still joins Teams Web as `Meeting STT Assistant` and can be admitted from the meeting lobby.

## Security behavior

By default, only organizers with the **same email domain as the bot mailbox** can trigger auto-join.

For:

```text
meetingbot@company.com
```

the default allowed organizer domain is:

```text
company.com
```

To allow multiple internal domains:

```env
MEETING_BOT_GRAPH_ALLOWED_ORGANIZER_DOMAINS=company.com,company.vn
```

External organizers are ignored even if they invite the shared mailbox. This prevents an outside sender from using the mailbox address to make the bot join arbitrary meetings.

The event must also show the bot mailbox as an attendee. Events created directly inside the bot mailbox calendar are ignored.

## Microsoft Entra / Graph access

Create a single-tenant Entra application for the background runner.

The integration needs effective calendar read access to the bot mailbox.

### Quick internal test

Grant Microsoft Graph **Application** permission:

```text
Calendars.Read
```

and grant tenant admin consent.

### Recommended production scope

Prefer Exchange Online **RBAC for Applications** so the service principal can read only the dedicated bot mailbox.

Assign the Exchange role:

```text
Application Calendars.Read
```

to a recipient scope containing only `meetingbot@company.com`.

Do not also leave an unscoped tenant-wide calendar grant if strict mailbox isolation is required, because authorization grants can combine.

The flow does not need:

- `Calendars.ReadWrite`
- `OnlineMeetings.Read.All`
- Teams Calling/Media permissions
- a Teams custom app

The Teams join URL comes from the Outlook event's `onlineMeeting.joinUrl`.

## Runner configuration

Example:

```env
MEETING_BOT_GRAPH_TENANT_ID=<tenant-id>
MEETING_BOT_GRAPH_CLIENT_ID=<application-client-id>
MEETING_BOT_GRAPH_CLIENT_SECRET=<client-secret>

MEETING_BOT_GRAPH_USER_ID=meetingbot@company.com
# Only needed if USER_ID above is an opaque Entra GUID.
MEETING_BOT_GRAPH_BOT_EMAIL=meetingbot@company.com

# Optional. Defaults to company.com when the bot address is meetingbot@company.com.
MEETING_BOT_GRAPH_ALLOWED_ORGANIZER_DOMAINS=company.com

MEETING_BOT_GRAPH_SYNC_MS=60000
MEETING_BOT_GRAPH_LOOKBACK_MIN=30
MEETING_BOT_GRAPH_LOOKAHEAD_HOURS=48
```

The legacy `MEETING_BOT_GRAPH_OWNER_EMAIL` value is still accepted as a fallback for `BOT_EMAIL` during upgrades, but new deployments should use `MEETING_BOT_GRAPH_BOT_EMAIL`.

## Verify before enabling auto-join

Run:

```bash
pnpm meeting:graph:check
```

The check reads the bot mailbox calendar but does not create bot sessions.

It reports:

- bot mailbox
- Graph mailbox/user
- number of calendar events
- Teams events
- eligible invited meetings
- meetings blocked because of organizer domain
- events where the bot mailbox is not an attendee

A valid test should look conceptually like:

```text
Bot mailbox: meetingbot@company.com
Eligible invited meetings: 1
- 2026-10-05T02:00:00.000Z | alice@company.com | Weekly Design Review
```

## Runtime behavior

Start:

```bash
pnpm meeting:bot
```

Every Graph synchronization:

1. Reads occurrences in the configured calendar window.
2. Requests UTC event times and immutable Outlook IDs.
3. Follows Graph pagination.
4. Reads `organizer`, `attendees`, `isOrganizer`, response status and Teams join information.
5. Requires the configured bot mailbox to be an attendee.
6. Requires the organizer's domain to be allowed.
7. Stores the organizer email as administrative `ownerEmail`.
8. Stores attendee emails (excluding the bot mailbox) on the occurrence's `MeetingBotSession` for implicit shared-room viewer access.
9. Ignores declined, cancelled, all-day or non-Teams events.
10. Reconciles reschedules and deletions so stale queued bot joins are removed.
11. Keeps recurring meeting occurrences independent.
12. Refreshes expired Graph tokens and retries temporary throttling/service failures.

## Recurring meetings

Users do not need to configure repeat rules in the Meeting web app when they create the recurrence in Outlook/Teams.

Example:

```text
Weekly Coordination
Every Monday 09:00
Attendees:
- team members
- meetingbot@company.com
```

Graph `calendarView` expands the recurring series into occurrences. Each occurrence creates one bot join near its own start time.

## Shared-room example

Alice creates:

```text
Weekly Review
Organizer: alice@company.com
Attendees:
- bob@company.com
- carol@company.com
- meetingbot@company.com
```

The generated Meeting keeps `alice@company.com` as its administrative owner, while Alice, Bob and Carol all open the **same** Meeting record and live transcript. Nobody needs to manually share the meeting with the other calendar attendees. Explicit `MeetingShare` remains available for people who were not on the Teams calendar occurrence or for editor upgrades.

## Internal web scheduler remains available

The existing `/meeting/bot` scheduler stays as a fallback.

So the product supports both:

```text
A. Invite meetingbot@company.com in Outlook/Teams -> Graph auto-schedules the bot
B. Paste a Teams link into the Meeting web app -> internal scheduler auto-schedules the bot
```

Both paths feed the same bot-session queue and use the same Teams Web runner.
