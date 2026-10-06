# Browser participant identity extraction

## Why this exists

The Meeting bot is a Playwright browser bot, not an official Teams media bot. Shared live STT needs participant email identities so signed-in Meeting users can automatically open the same shared room.

Email identity must never be guessed from a display name.

## Source priority

The runner accumulates attendee emails from multiple independent sources:

1. **Teams Web People/Profile cards** — while the bot is already inside the meeting, inspect participant/contact cards and accept only email addresses visibly exposed by Teams.
2. **Outlook Web Calendar** — authenticated bot mode opens Outlook Calendar in a second tab, finds the meeting by title, opens the event card, and reads visible attendee email addresses.
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

Authenticated mode reuses the same saved Microsoft browser session in a second tab.

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

The guest can still read the Teams People panel display names when Teams exposes them, but email visibility is not guaranteed. Outlook Web fallback is not available because the guest has no signed-in Microsoft session.

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

Identity collection follows actual meeting presence, not the invitation list.

| Situation | Behavior |
| --- | --- |
| Meeting is only scheduled | No participant email extraction yet. |
| Meeting is cancelled before the bot joins | No participant email is granted from the cancelled meeting. The join/session lifecycle handles the failure separately. |
| Bot is waiting in the lobby | No participant email extraction yet because the bot cannot reliably inspect the live People roster. |
| Bot is admitted / capture starts | Open People and run an immediate identity probe. |
| Meeting starts with only one or a few people | Resolve whoever is actually visible; do not wait for the full invited group. |
| A new participant joins later | Roster polling notices a new display name and triggers an identity probe immediately instead of waiting for the periodic probe. |
| A participant leaves | Keep any already verified attendee email. Leaving the call does not revoke access to the shared meeting result. |
| A participant leaves before email resolution | Their display name remains in the historical observed roster; authenticated Outlook fallback may still resolve that observed name later. |
| A participant rejoins | The historical roster/email sets deduplicate the participant; no duplicate access record is created. |
| Long meeting with no roster change | Run a periodic identity retry every 60 seconds to recover from transient UI/profile-card failures. |
| Meeting is ending | Run one final best-effort identity probe before the bot closes Teams. |
| External/anonymous participant exposes no email | Do not guess. They do not receive automatic account-based access unless another trusted source resolves them or someone explicitly shares the meeting. |

### Authorization rule

Outlook is an identity resolver, not the authorization source.

The bot first observes a participant in the Teams People roster. Only then may authenticated Outlook Web be used to resolve that observed display name to an email. A person who is merely invited in Outlook but never appears in Teams must not gain automatic shared-room access.

Once an observed participant is resolved to a verified email, that email remains on the MeetingBotSession for the whole meeting and post-meeting result.
