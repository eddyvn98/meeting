# Meeting source

An isolated source checkout for CI and development testing. It contains the Meeting routes, APIs, processing modules, and the shared files those modules import. The app shell and database schema are limited to Meeting needs.

## Local checks

- `pnpm install`
- `pnpm prisma:validate`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Set `DATABASE_URL` for commands that need Prisma configuration. Do not add production credentials to this repository. CI validates and builds only; it does not deploy.

## Teams browser bot

The repository includes an unattended Teams Web runner:

- `scripts/meeting-bot-runner.mjs`: lifecycle, Teams Web join, recording and automatic leave.
- `scripts/meeting-bot-audio.mjs`: isolated PulseAudio sink/source per meeting.
- `scripts/meeting-bot-calendar.mjs`: optional Microsoft Graph calendar discovery.
- `/meeting/bot`: internal meeting scheduler (paste Teams link/invitation, one-time or recurring).

The runner must execute on **Linux** with PulseAudio/PipeWire Pulse compatibility and Chromium. It is deliberately separate from the Next.js web process.

### Internal scheduling (no Microsoft admin approval required)

The app owns its own meeting schedules. Open `/meeting/bot`, paste either a Teams join URL or a full Outlook/Teams invitation, choose the start time and an optional repeat rule, then save.

Supported repeats: never, daily, weekdays, weekly, every two weeks, and monthly.

The Linux runner polls due schedules, creates exactly one bot session for each occurrence, joins Teams Web, waits in the lobby for a participant to admit it, records/transcribes, and leaves when the meeting ends. Microsoft Graph is optional and is not required for this flow.

See `docs/meeting-bot.md` for Linux setup, environment variables, Graph setup and the acceptance checklist.
