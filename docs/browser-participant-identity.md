# Browser participant identity extraction

## Why this exists

The Meeting bot is a Playwright browser bot, not an official Teams media bot. Shared live STT needs participant email identities so signed-in Meeting users can automatically open the same shared room.

Email identity must never be guessed from a display name.

## Source priority

The runner accumulates attendee emails from multiple independent sources:

1. **Teams Web People/Profile cards** — while the bot is already inside the meeting, inspect participant/contact cards and accept only email addresses visibly exposed by Teams.
2. **Outlook Web Calendar** — a saved Microsoft browser session opens Outlook Calendar, verifies the matching Teams event, and reads the invitee email list. This session is independent of whether the Teams join itself is Guest or authenticated.
3. **Microsoft Graph Calendar** — optional compatibility source when an administrator has configured Graph credentials.

All sources are merged into `MeetingBotSession.attendeeEmails`. Browser-derived updates are unioned with existing values and never erase a stronger source.

## Failure isolation

Participant identity extraction is a convenience/access-control side channel. It must never become a dependency of recording or STT.

If Teams or Outlook changes layout:

- recording continues;
- live STT continues;
- transcript processing continues;
- the runner logs an identity-degraded warning after repeated authenticated Teams probes return no email;
- only automatic shared-room access may be incomplete until a fallback succeeds.

The event API accepts runner-reported `attendeeEmails` and unions them with existing session identities.

## Teams Web strategy

`scripts/meeting-bot-participant-identities.mjs` deliberately avoids deriving an address from a person's display name.

It looks for:

- visible `mailto:` links;
- visible email-shaped text inside the People/roster region;
- participant profile/contact cards opened from the roster.

The People panel still uses the existing best-effort roster reader for display names. Profile clicks are scoped to the roster whenever possible.

## Outlook Web fallback

A saved Microsoft browser session is used to read Outlook. If the Teams join is authenticated, the same session can be reused. If the Teams join is Guest, the runner can launch a separate authenticated Outlook browser using `MEETING_BOT_IDENTITY_AUTH_STATE`.

The fallback:

1. opens Outlook Web Calendar;
2. finds the current meeting by title;
3. opens the event;
4. verifies that the event exposes the same Teams join URL identity as the active bot session;
5. expands attendee/participant details when available;
6. reads visible `mailto:` links or email-shaped text only from the verified event dialog;
7. closes the tab.

Meeting title alone is never sufficient for authorization because duplicate titles are common.

It is intentionally best-effort and bounded. A redirect to Microsoft login, a missing event, hidden attendee list, or changed layout simply returns no identities.

## Guest versus authenticated mode

### Authenticated bot

Best identity coverage:

- Teams profile/contact cards may expose internal email addresses;
- Outlook Web SSO may expose calendar attendee emails;
- Graph remains optional.

### Guest bot

The Guest Teams page can still read People/profile data when Teams exposes it. In addition, Guest join can use a **separate authenticated Outlook identity session** from `MEETING_BOT_IDENTITY_AUTH_STATE`, so invited people who never join can still receive shared-room access. If that auth state is missing or expired, invite-list discovery degrades but recording/STT continues.

## Resilience model

Use a layered approach rather than one brittle selector:

1. deterministic Playwright role/text locators;
2. broad semantic containers and visible `mailto:` extraction;
3. multiple browser surfaces (Teams + Outlook);
4. optional Graph source;
5. diagnostic warning without stopping the meeting.

Do not make a single CSS/XPath selector the only path to participant identity.

## AI/browser-agent fallback

If Microsoft UI churn becomes frequent enough that the deterministic layers require repeated manual repair, add an AI-assisted fallback behind a feature flag rather than replacing Playwright.

Recommended fit for this TypeScript codebase:

- **Stagehand** — Playwright-compatible TypeScript SDK with deterministic code plus AI `act`/`extract`/`observe` primitives; best fit for a small self-healing fallback.
- **Browser Use** — very strong general browser-agent ecosystem, but the main open-source runtime is Python and would add a second runtime to this bot.
- **Skyvern** — strong vision/agent browser automation, but heavier and AGPL; better as a separate automation service than a small embedded fallback.

AI fallback must remain optional. Meeting capture must still work when the model/API is unavailable.


## Headless diagnostics

Identity extraction emits structured log lines in this shape:

```text
[meeting-bot][identity] session=<id> source=<teams|outlook|session|server> code=<REASON_CODE> ...
```

Important reason codes:

| Code | Meaning |
| --- | --- |
| `PEOPLE_PANEL_OPEN_FAILED` | The runner could not open the Teams People/Participants panel. |
| `ROSTER_NOT_VISIBLE` | No supported visible People/roster container was found. |
| `PARTICIPANT_ROW_NOT_VISIBLE` | A roster name was known but no clickable participant row was visible. |
| `PROFILE_OPEN_FAILED` | Playwright found the participant row but could not open the profile/contact card. |
| `PROFILE_CARD_NOT_VISIBLE` | The click completed but no supported visible profile-card container appeared. |
| `PROFILE_CARD_NO_EMAIL` | A profile card was visible but it exposed no email address. |
| `PROFILE_EMAIL_FOUND` | Teams exposed at least one new participant email. |
| `OUTLOOK_AUTH_REQUIRED` / `AUTH_REQUIRED` | The saved Microsoft session did not carry into Outlook Web. |
| `EVENT_NOT_FOUND` | Outlook Calendar did not expose a matching event title in the current day view. |
| `JOIN_URL_MISMATCH` | An Outlook event was opened, but its Teams join URL did not match the active bot session. |
| `VERIFIED_EVENT_NO_EMAIL` | The verified Outlook event exposed no attendee email addresses. |
| `EMAILS_MERGED` | The runner accepted new email identities from a source. |
| `PERSIST_REQUESTED` / `PERSIST_CONFIRMED` | The runner sent newly discovered identities to the Meeting server. |
| `ATTENDEE_EMAILS_PERSISTED` | The server confirmed that the session stored more attendee emails. |
| `IDENTITY_DEGRADED` | Repeated authenticated probes still produced no email; recording/STT continues. |

The default logs intentionally report counts and reasons instead of printing the email addresses themselves.

### Optional screenshots

Headless screenshots are disabled by default because meeting/profile/calendar screens can contain confidential information.

Enable them only while troubleshooting:

```env
MEETING_BOT_DEBUG_ARTIFACTS=true
MEETING_BOT_DEBUG_DIR=.meeting-bot-debug
```

When enabled, failures such as roster not visible, profile open failure, Outlook authentication, event-not-found, join-URL mismatch, and verified-event-without-email save a full-page PNG and log:

```text
code=SCREENSHOT_SAVED path=...
```

Do not upload this directory to source control. Treat screenshots as potentially sensitive meeting data and delete them after debugging.

## AI fallback configuration

The current browser identity implementation uses plain Playwright only and requires **no AI API key**.

If Stagehand or another AI browser-agent fallback is added later, keep it behind a feature flag. Only that optional fallback would need a model/API credential (or a locally hosted compatible model). Recording, STT, and the deterministic Playwright path must remain usable without any AI key.


## When participant email extraction runs

Shared-room membership is the union of:

1. **people invited to the verified Outlook/Teams event**, whether they attend or not; and
2. **people actually observed in Teams**, including ad-hoc attendees who were not on the original invitation, when their email can be resolved safely.

| Situation | Behavior |
| --- | --- |
| Meeting is only scheduled, bot has not joined | No shared live Meeting exists yet from this runner, so no browser identity extraction is needed. |
| Meeting is cancelled before the bot joins | The bot never starts capture; no live room is created by this run. |
| Bot is waiting in the lobby | Do not start shared-room identity collection yet. |
| Bot is admitted / capture starts | Immediately verify the Outlook event by Teams join URL and ingest the full visible invitee email list. Then probe Teams People/profile cards. |
| Invited person never joins | They still keep access because membership comes from the verified invitation list. |
| Meeting starts with only some invitees present | All discovered invitees can see the live room; present participants are also probed through Teams. |
| A new invited person joins later | They already have access from Outlook; Teams probe may confirm/add identity data. |
| An uninvited/ad-hoc person joins | Teams profile/contact extraction may add their email and grant access. Never guess from display name. |
| A participant leaves early | Keep access permanently for that meeting/result. |
| A participant rejoins | Email/name sets are deduplicated; no duplicate access entry is created. |
| Invitation list changes during a long meeting | Outlook is retried every 5 minutes so newly invited people can gain access. |
| Teams UI/profile extraction transiently fails | Retry every 60 seconds and immediately when a new roster name appears. |
| Meeting is ending | Refresh Outlook invitees and run one final Teams identity probe before closing the browser. |
| External/anonymous participant exposes no email and is not resolvable from the invite list | Do not guess; explicit share remains the fallback. |

### Authorization rule

A **verified Outlook invitation list is authoritative for invitees** only after the event's Teams join URL matches the active bot session. Meeting title alone is never sufficient.

Teams People/profile cards are the complementary source for actual attendees, especially people who joined ad hoc and were not present in the original invitation.

Once an email is accepted from either trusted source, it remains on `MeetingBotSession.attendeeEmails` for the live room and post-meeting result.
