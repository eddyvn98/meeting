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
- `/meeting/bot`: manual and scheduled-test UI.

The runner must execute on **Linux** with PulseAudio/PipeWire Pulse compatibility and Chromium. It is deliberately separate from the Next.js web process.

### Test before requesting Microsoft admin approval

You can verify the entire scheduler/join/record/leave flow without Microsoft Graph:

1. Run the web app and Linux bot runner.
2. Open `/meeting/bot`.
3. Paste a Teams meeting URL.
4. Use **Scheduled test time**, or one of **In 2/5/10 min**.
5. Keep `MEETING_BOT_GRAPH_*` empty.
6. Confirm the session moves through Starting -> Joining -> Waiting/In meeting -> Recording -> Finished.

This exercises the same database queue and claim logic used by calendar-discovered meetings. Microsoft Graph is only needed to replace the manually scheduled test with real calendar discovery.

See `docs/meeting-bot.md` for Linux setup, environment variables, Graph setup and the acceptance checklist.
