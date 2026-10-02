# Meeting Bot - test and deployment guide

## Goal

Prove the unattended Teams meeting workflow end-to-end before asking a Microsoft 365 administrator for calendar permissions.

The current design is a **Teams Web browser bot**, not a Microsoft Graph Communications media bot. It joins the meeting as a browser participant named `Meeting STT Assistant`, routes Teams audio through PulseAudio, records through the existing Meeting STT UI, finalizes processing, and leaves automatically.

## What can be tested without Microsoft Graph

The `/meeting/bot` page supports a **Scheduled test time**. A scheduled manual session is stored in the same `meeting_bot_sessions` queue as a calendar-discovered session. The runner's claim endpoint does not distinguish between the two when deciding when to start.

This lets you validate:

- scheduling
- claim timing
- Teams Web navigation
- lobby detection
- audio routing
- recording creation
- STT/finalization
- stop handling
- automatic leave when the call ends
- automatic leave after the bot is alone
- maximum call duration
- stale runner recovery

Calendar discovery itself is the only step that remains untested until Microsoft Graph credentials are supplied.

## Linux runner prerequisites

Use a Linux host. The runner intentionally refuses to start on Windows or macOS.

Typical Debian/Ubuntu packages:

```bash
sudo apt update
sudo apt install -y pulseaudio pulseaudio-utils
```

Install Node.js 22 and pnpm, then:

```bash
pnpm install
pnpm exec playwright install chromium
```

If Chromium reports missing system libraries, use Playwright's supported dependency installer on the Linux runner:

```bash
pnpm exec playwright install-deps chromium
```

Start PulseAudio if the host does not already expose a Pulse-compatible audio server:

```bash
pulseaudio --start
pactl info
```

`pactl info` must succeed before starting the bot.

## Environment

Copy `.env.example` and configure at minimum:

```env
DATABASE_URL=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://your-meeting-app.example.com

MEETING_BOT_BASE_URL=https://your-meeting-app.example.com
MEETING_BOT_RUNNER_TOKEN=...
MEETING_BOT_TEAMS_DISPLAY_NAME=Meeting STT Assistant
```

`MEETING_BOT_BASE_URL` must be reachable from the Linux runner.

The bot recorder creates its authenticated application session using `NEXTAUTH_SECRET`, so the runner and web app must use the same secret.

Do not expose `MEETING_BOT_RUNNER_TOKEN` in the browser or commit it to Git.

## Run

Web application:

```bash
pnpm build
pnpm exec next start
```

Bot runner in a separate process:

```bash
pnpm meeting:bot
```

For initial debugging keep:

```env
MEETING_BOT_HEADLESS=false
```

Once the Teams selectors and audio path are proven on the target host, headless mode can be tested separately.

## End-to-end test without admin approval

1. Create a short Microsoft Teams meeting that permits the browser participant to join.
2. Start the Meeting web app.
3. Start `pnpm meeting:bot` on Linux.
4. Open `/meeting/bot`.
5. Paste the Teams URL.
6. Click **In 2 min**.
7. Click **Schedule test**.
8. Verify the row shows a scheduled time and remains in Starting until the claim window.
9. Around one minute before the selected time, verify it changes to Joining.
10. Admit `Meeting STT Assistant` if the meeting policy puts guests in the lobby.
11. Speak for at least 30-60 seconds.
12. End the Teams meeting.
13. Verify the bot session becomes Finished.
14. Open the generated Meeting recording and verify audio/transcript/processing output.

Repeat with:

- manually pressing Stop bot
- leaving the bot alone for the configured timeout
- a second meeting to verify queue reuse
- two simultaneous meetings if `MEETING_BOT_MAX_CONCURRENCY=2`

## Microsoft Graph calendar discovery

Calendar discovery is disabled unless all four values are present:

```env
MEETING_BOT_GRAPH_TENANT_ID=
MEETING_BOT_GRAPH_CLIENT_ID=
MEETING_BOT_GRAPH_CLIENT_SECRET=
MEETING_BOT_GRAPH_USER_ID=
```

The runner uses OAuth 2.0 client credentials and calls the configured user's `calendarView` for the window from five minutes ago through the next 24 hours. Events with a Teams join URL are inserted as `CALENDAR` bot sessions.

Before production rollout, ask the Microsoft 365 administrator for a dedicated single-tenant Entra application and the smallest approved application-level calendar permission that returns the fields required by this implementation. Restrict access to the intended mailbox(es) using the organization's Exchange/Graph application access controls where available.

Do not request Teams calling/media permissions for this browser-bot implementation; they are not used by the current source.

## Acceptance checklist before asking IT to publish anything

The bot is ready for the admin-integration phase when all of these pass:

- [ ] CI passes: Prisma validation, tests, TypeScript and Next.js build.
- [ ] Linux runner starts with `pactl info` healthy.
- [ ] Immediate manual bot request joins a test meeting.
- [ ] Scheduled test remains queued and joins at the expected time.
- [ ] Lobby state is shown correctly.
- [ ] Audio is captured into the Meeting recorder.
- [ ] A normal meeting end triggers finalize and Finished.
- [ ] Stop bot ends capture cleanly.
- [ ] Alone timeout causes the bot to leave.
- [ ] Generated meeting reaches READY or a clear FAILED state rather than remaining stuck.
- [ ] No production secrets are committed.

After this checklist passes, the remaining admin request is narrow: create/approve the Entra application for calendar discovery and authorize the required mailbox scope.

## Known operational limitation

The current bot joins Teams Web as a guest/browser participant. Tenant meeting policies can require lobby admission or can block anonymous participants entirely. Those policies cannot be bypassed by this repository and must be handled through an approved Microsoft 365 configuration or by changing the bot architecture.
