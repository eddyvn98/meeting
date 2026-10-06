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
4. expands attendee/participant details when available;
5. reads visible `mailto:` links or email-shaped text;
6. closes the tab.

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
