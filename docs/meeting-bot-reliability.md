# Meeting Bot reliability matrix

This document describes the unattended Teams browser bot behavior after a session is claimed.

## State flow

```text
REQUESTED
  -> CLAIMED
  -> JOINING
  -> LOBBY (optional)
  -> JOINED
  -> CAPTURING
  -> STOP_REQUESTED
  -> ENDED

Any unrecoverable infrastructure failure may end at FAILED.
```

## Expected failure handling

| Scenario | Expected behavior |
| --- | --- |
| Outlook meeting cancelled before start | Pending CALENDAR session is removed. |
| Outlook meeting cancelled while active | Session becomes STOP_REQUESTED and captured audio is finalized. |
| Internal schedule paused/deleted | Pending sessions are removed; active sessions receive STOP_REQUESTED. |
| Meeting rescheduled | Old pending occurrence is removed/stopped; new occurrence is queued. |
| Lobby waits a long time | Bot waits up to MEETING_BOT_LOBBY_TIMEOUT_MS, then fails cleanly. |
| Lobby request rejected | Bot ends without retrying because rejection is intentional. |
| Saved Teams login expired/revoked | Session fails fast with `TEAMS_AUTH_REQUIRED`; rerun `pnpm meeting:bot:auth` before retrying. |
| Bot removed/kicked during capture | Bot does not rejoin; existing recording is finalized. |
| Organizer ends meeting | Recorder pauses and a short rejoin window starts. |
| Meeting restarts inside rejoin window | Bot rejoins only after another participant is detected, then recording resumes. |
| Meeting does not restart | Recording is finalized after the rejoin window. |
| Teams says reconnecting | Recorder pauses; Teams browser is relaunched/rejoined; recorder resumes. |
| Teams Chromium closes/crashes | Runner attempts a fresh Teams browser and rejoins. |
| Recorder browser crashes | Current session fails and an idempotent continuation session is queued. |
| Runner dies before CAPTURING | Expired lease returns the session to REQUESTED. |
| Runner dies during CAPTURING | After the longer capture lease expires, the old session becomes FAILED and one bounded continuation is queued. |
| App/API temporarily unavailable | Runner claim loop retries instead of exiting; heartbeat calls are best-effort. |
| Graph outage causes an old occurrence to arrive late | CALENDAR late-grace marks it missed instead of joining much later. |
| Web schedule and Graph describe the same occurrence | URL/time dedupe and advisory lock allow one bot session. |
| Bot joins before everyone else | Initial-alone grace keeps it waiting for a late start. |
| Bot is alone after people have joined | Continuous alone timeout ends the session. |
| Vietnamese Teams roster text | Participant count parser handles common Vietnamese forms. |
| Audio track exists but is silent | Browser RMS health monitor detects prolonged silence. |
| Silent audio while >1 participant is present | Teams audio route is reconnected once per recovery cooldown. |
| Meeting exceeds max duration | Bot ends and finalizes at the configured safety ceiling. |
| Post-processing browser is slow | Processing wait has a bounded timeout and recovery fallback. |

## Default recovery windows

```env
MEETING_BOT_LOBBY_TIMEOUT_MS=900000
MEETING_BOT_RECONNECT_TIMEOUT_MS=120000
MEETING_BOT_REJOIN_WINDOW_MS=120000
MEETING_BOT_REJOIN_ATTEMPT_MS=30000
MEETING_BOT_MAX_CONTINUATIONS=2
MEETING_BOT_CAPTURE_LEASE_TIMEOUT_MS=300000
MEETING_BOT_INITIAL_ALONE_GRACE_MS=900000

MEETING_BOT_AUDIO_INITIAL_SIGNAL_MS=60000
MEETING_BOT_AUDIO_SILENCE_MS=180000

MEETING_BOT_SCHEDULE_LATE_GRACE_MS=600000
MEETING_BOT_CALENDAR_LATE_GRACE_MS=600000
```

The rejoin window is deliberately short. A Teams meeting link may remain reusable after the organizer ends the call, so the bot must not repeatedly resurrect a finished meeting by itself. During restart recovery it only resumes recording after it can observe another participant.

## Audio health

The recorder exposes a lightweight browser-side RMS snapshot for bot capture:

```text
startedAt
lastSampleAt
lastSignalAt
rms
peakRms
```

The watchdog distinguishes an existing audio track from actual measurable audio samples.

Initial silence and normal quiet periods do not immediately fail a meeting. If the configured silence threshold is exceeded and the Teams roster shows more than one participant, the runner pauses recording, recreates the Teams audio route/browser, rejoins, and resumes recording.

## Continuations

Intentional removal:

```text
host removes bot
  -> finalize captured audio
  -> ENDED
  -> no automatic rejoin
```

Infrastructure failure:

```text
recorder crashes
  -> current session FAILED
  -> uploaded recovery data remains
  -> create one idempotent continuation session
  -> continuation rejoins the same Teams link
```

The continuation chain is bounded by MEETING_BOT_MAX_CONTINUATIONS so a broken runner cannot loop forever.

## Cross-source deduplication

The product has two scheduling sources:

```text
SCHEDULE = user pasted the Teams URL into Meeting
CALENDAR = meetingbot@company.com was invited through Outlook/Teams
```

Before creating a bot occurrence, both paths serialize creation with a PostgreSQL advisory lock based on the Teams URL and search a +/-10 minute time window. Existing sessions, including terminal ones for that occurrence, suppress a second session.

This prevents:

```text
invite meetingbot@company.com
+
also paste the same link into /meeting/bot
=
only one bot joins
```

## Production E2E checklist

Run these on a real Linux runner and Teams tenant before calling the deployment unattended-ready:

1. Normal meeting, admitted from lobby, audio contains speech.
2. Lobby admission delayed 3-5 minutes.
3. Lobby request rejected.
4. Host removes the bot during capture.
5. Organizer ends meeting normally.
6. Organizer ends meeting and restarts it within the rejoin window.
7. Disconnect runner network for 20-30 seconds and restore it.
8. Kill only the Teams Chromium process.
9. Kill only the recorder Chromium process.
10. Speak, remain silent past the audio warning threshold, then speak again.
11. Cancel a future Outlook meeting.
12. Reschedule a future Outlook meeting.
13. Stop Graph access long enough to exceed calendar late-grace, then restore it.
14. Schedule the same Teams meeting through Graph and the web scheduler.
15. Restart the runner before join.
16. Restart the runner during capture.
17. Leave the bot alone until the alone timeout.
18. Run two unrelated meetings concurrently up to MEETING_BOT_MAX_CONCURRENCY.

For every case confirm both the bot-session terminal state and the recorded Meeting result/audio.
