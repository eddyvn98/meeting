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

Every signed-in person whose verified email belongs to the shared-room membership has implicit **viewer** access to that Meeting. Membership is the union of the verified Outlook invitation list and additional actual Teams attendees whose email can be resolved safely. No manual `MeetingShare` row is required.

`MeetingShare` is reserved for explicit access outside the Teams attendee list, or for upgrading somebody to editor.

## Identity source

The unattended bot is a Playwright Teams Web runner, not a Microsoft Graph Communications media bot. The Teams DOM roster only provides best-effort display names and must not be used as the authorization identity source.

Shared-room authorization comes from trusted attendee email identities stored on `MeetingBotSession.attendeeEmails`. The browser bot can now populate them directly from visible Teams profile/contact cards and, in authenticated mode, Outlook Web Calendar. Microsoft Graph Calendar remains an optional additional source rather than a requirement.

Calendar-backed sessions may still use the existing Graph occurrence key when Graph is configured, but Graph is not required for browser identity extraction. The active Teams join URL is also used to verify that an Outlook event is the same meeting before invitee emails are accepted.

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

Automatic membership requires a trusted email identity. A display name alone is never enough. Outlook Web can provide the verified invitation list even when the Teams join itself is Guest, as long as a separate saved Microsoft identity session is configured. Teams profile cards supplement that list for ad-hoc attendees who actually join.

If no source exposes an email, recording and STT continue normally but automatic shared-room access can be incomplete. Do not replace this rule with broad company-wide live-meeting visibility and do not infer authorization from participant display names.

See `docs/browser-participant-identity.md` for source priority and resilience behavior.

### Recovery boundary

The normal calendar occurrence path resolves to one shared Meeting. The existing runner continuation mechanism can still create a second recovery recording if the recorder process dies after capture has already started. Attendee identities are preserved onto that continuation so access is not lost, but consolidating recovery fragments back into one physical Meeting record is a separate reliability task. Do not confuse this edge case with the shared-room authorization model.
