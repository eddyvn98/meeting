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
- `scripts/meeting-bot-calendar.mjs`: optional Microsoft Graph Outlook calendar synchronization.
- `/meeting/bot`: internal meeting scheduler (paste Teams link/invitation, one-time or recurring).

The runner must execute on **Linux** with PulseAudio/PipeWire Pulse compatibility and Chromium. It is deliberately separate from the Next.js web process.

### Internal scheduling (no Microsoft admin approval required)

The app owns its own meeting schedules. Open `/meeting/bot`, paste either a Teams join URL or a full Outlook/Teams invitation, choose the start time and an optional repeat rule, then save.

Supported repeats: never, daily, weekdays, weekly, every two weeks, and monthly.

The Linux runner polls due schedules, creates exactly one bot session for each occurrence, joins Teams Web, waits in the lobby for a participant to admit it, records/transcribes, and leaves when the meeting ends. Microsoft Graph is optional and is not required for this flow.

See `docs/meeting-bot.md` for the runner and internal scheduler, and `docs/microsoft-graph-calendar.md` for Microsoft Graph / Outlook calendar setup.


### Optional Outlook calendar sync

Microsoft Graph can automatically discover Teams meetings from one configured Outlook mailbox. The Graph path is independent of the internal scheduler and does not require a Teams custom app.

After an administrator supplies the Entra application credentials and `Calendars.Read` application access, verify the connection with:

```bash
pnpm meeting:graph:check
```

Then the normal `pnpm meeting:bot` runner synchronizes Outlook meetings in the background.
