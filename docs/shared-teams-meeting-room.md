# Shared Teams meeting room invariant

## Product rule

A Teams meeting is one shared room in the Meeting web app.

The person who created the Outlook event, invited the bot, or caused the bot to join is **not** the owner of the meeting content in the product sense. `Meeting.ownerEmail` remains an administrative field for destructive/configuration actions only.

For one Teams calendar occurrence there must be one Meeting record and one live transcript stream:

```text
Teams calendar occurrence
        |
        v
MeetingBotSession
        |
        v
one Meeting / meetingId
        |
        +-- live STT shared by attendees
        +-- Overview shared by attendees
        +-- Transcript shared by attendees
        +-- Minutes shared by attendees
```

Every signed-in attendee whose email is present in the Graph calendar occurrence has implicit **viewer** access to that Meeting. No manual `MeetingShare` row is required.

`MeetingShare` is reserved for explicit access outside the Teams attendee list, or for upgrading somebody to editor.

## Identity source

The unattended bot is a Playwright Teams Web runner, not a Microsoft Graph Communications media bot. The Teams DOM roster only provides best-effort display names and must not be used as the authorization identity source.

Shared-room authorization comes from Outlook/Microsoft Graph calendar attendee email addresses captured by `scripts/meeting-bot-calendar.mjs` and stored on `MeetingBotSession.attendeeEmails`.

The occurrence identity remains the existing Graph source key:

```text
graph:{mailboxKey}:{eventId}:{scheduledAt}
```

This matters for recurring meetings that reuse the same Teams join URL.

## Access model

Effective access is resolved in this order:

1. administrative owner -> `owner`
2. active explicit `MeetingShare` -> `editor` or `viewer`
3. attendee email on the linked `MeetingBotSession` -> `viewer`
4. otherwise -> no access

Attendee access survives after the meeting ends because the bot session remains linked to the Meeting.

## Live behavior

When the linked bot session status is `CAPTURING`, GET `/api/meeting` returns `isLive: true`.

Attendees opening the Meeting web app should see the same live meeting and open:

```text
/meeting/{meetingId}
```

That page subscribes to the shared SSE endpoint:

```text
/api/meeting/{meetingId}/live-transcript
```

All authorized viewers receive the same persisted transcript segments. Translation/display language remains a per-browser/user preference and does not fork the Meeting.

## Important limitation

Automatic attendee membership currently requires a calendar-backed bot session whose Graph event exposes attendee email addresses. A manually pasted Teams URL has no reliable attendee email identity source, so it cannot safely grant automatic room access merely from Teams Web display names.

Do not replace this rule with broad company-wide live-meeting visibility and do not infer authorization from participant display names.
