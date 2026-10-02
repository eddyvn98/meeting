# Meeting Bot - scheduling and deployment guide

## Goal

Run the complete Meeting workflow without requiring a Teams custom app or Microsoft Graph calendar access:

1. Paste a Teams join link or the full meeting invitation into the Meeting web app.
2. Set or confirm the meeting start time.
3. Optionally choose a repeat rule.
4. Save.
5. The Linux runner joins automatically near the scheduled time.
6. A participant admits `Meeting STT Assistant` from the Teams lobby when required.
7. Existing recording, STT, summary, minutes and action-item processing runs normally.
8. The bot leaves when the call ends or its configured safety timeout is reached.

## Internal schedules

The `/meeting/bot` page is the source of truth for V1 scheduling. It does not depend on Outlook or Microsoft Graph.

A schedule stores:

- Teams meeting URL
- title
- first start time
- next run time
- repeat rule
- enabled/paused state
- last triggered occurrence

Supported repeat rules:

- Never
- Every day
- Every weekday
- Every week
- Every 2 weeks
- Every month

The runner polls `/api/meeting/bot-schedules/dispatch`. When an occurrence is due, the API creates one `SCHEDULE` bot session using a unique occurrence key, advances the schedule to its next run, and the normal bot-session claim flow takes over. Repeated polling therefore does not create duplicate sessions for the same occurrence.

## Pasting an invitation

The scheduler accepts either:

- a plain Teams join URL, or
- copied Outlook/Teams invitation text.

When invitation text contains recognizable data, the browser extracts:

- Teams join URL
- meeting title
- start date/time

The extracted values remain editable before saving. If only a link is pasted, the user simply chooses the date/time manually.

Numeric dates are interpreted as day/month/year, matching the primary deployment locale.

## Database migration

After pulling a version that contains recurring schedules, apply migrations before starting the app:

```bash
pnpm install
pnpm exec prisma migrate deploy
pnpm run prisma:generate
```

The migration adds `meeting_bot_schedules`, the `MeetingScheduleRepeat` enum and the `SCHEDULE` bot-session source.

## Linux runner prerequisites

The unattended bot runner currently requires Linux with a Pulse-compatible audio server and Chromium.

Typical Debian/Ubuntu setup:

```bash
sudo apt update
sudo apt install -y pulseaudio pulseaudio-utils
pnpm install
pnpm exec playwright install chromium
```

If Chromium reports missing system libraries:

```bash
pnpm exec playwright install-deps chromium
```

Verify audio:

```bash
pulseaudio --start
pactl info
```

`pactl info` must succeed before the runner starts.

## Environment

Minimum application/runner configuration:

```env
DATABASE_URL=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://your-meeting-app.example.com

MEETING_BOT_BASE_URL=https://your-meeting-app.example.com
MEETING_BOT_RUNNER_TOKEN=...
MEETING_BOT_TEAMS_DISPLAY_NAME=Meeting STT Assistant
MEETING_BOT_SCHEDULE_POLL_MS=15000
MEETING_BOT_LOBBY_TIMEOUT_MS=900000
MEETING_BOT_RECONNECT_TIMEOUT_MS=120000
MEETING_BOT_REJOIN_WINDOW_MS=120000
MEETING_BOT_CALENDAR_LATE_GRACE_MS=600000
```

`MEETING_BOT_BASE_URL` must be reachable from the Linux runner. The runner and web application must use the same `NEXTAUTH_SECRET`.

Do not expose `MEETING_BOT_RUNNER_TOKEN` in browser code or commit real credentials.

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

For initial troubleshooting, `MEETING_BOT_HEADLESS=false` makes it easier to inspect the Teams browser. Production environments without a display normally need headless mode or an appropriate virtual display setup.

## End-to-end acceptance test

1. Create a short Teams meeting.
2. Start the web app and Linux runner.
3. Open `/meeting/bot`.
4. Paste the Teams invitation.
5. Confirm the detected title/time, or set them manually.
6. Choose **Never** and save a meeting a few minutes in the future.
7. Confirm the schedule appears with **Auto join ON**.
8. Near the start time, confirm it appears under Bot activity as Joining/Waiting.
9. Admit `Meeting STT Assistant` from the lobby if Teams requires it.
10. Speak for at least 30-60 seconds.
11. End the Teams meeting.
12. Confirm the bot session finishes and the generated Meeting reaches its normal processed result.
13. Repeat once with **Every week**, confirm the first occurrence runs, and confirm the schedule advances to the next week's date instead of creating duplicate sessions.

Also verify:

- Pause prevents future dispatch.
- Enable recalculates the next occurrence.
- Edit changes link/time/repeat.
- Delete removes the schedule.
- Stop bot ends an active occurrence cleanly.
- A runner restart does not duplicate an already-dispatched occurrence.

## Microsoft Graph Outlook sync is optional and complete

The internal scheduler does not require Microsoft Graph. When Graph credentials are configured, the same runner also synchronizes Outlook calendar meetings into the bot queue.

The Graph integration:

- uses app-only OAuth client credentials
- reads the configured mailbox with `Calendars.Read`
- follows Graph pagination
- requests UTC times and immutable event IDs
- uses `onlineMeeting.joinUrl`
- reconciles cancellations, deletions and reschedules
- reads the dedicated bot mailbox while assigning generated Meeting ownership to the allowed organizer
- retries token expiry and temporary Graph throttling/service failures

Before enabling it, run:

```bash
pnpm meeting:graph:check
```

Full setup and administrator guidance: `docs/microsoft-graph-calendar.md`.

For unattended failure/recovery behavior and the production E2E matrix, see `docs/meeting-bot-reliability.md`.

## Teams custom app is a separate future layer

A Teams custom app is also not required for this V1. It can later provide a wider Teams-native experience such as tabs, side panels, bot/chat interactions and notifications while reusing this same Meeting backend.

## Operational behavior

The current bot joins Teams Web as a browser participant. Tenant meeting policies can place it in the lobby or block anonymous participants. A human participant may still need to admit the bot.

The runner now distinguishes intentional removal/rejection from infrastructure interruptions, retries Teams/network/browser failures, watches for real audio signal, protects against late calendar joins and duplicate scheduling sources, and supports a short meeting-restart rejoin window. These safeguards reduce unattended failure, but the deployment still needs the real-tenant E2E checklist in `docs/meeting-bot-reliability.md` before production sign-off.
