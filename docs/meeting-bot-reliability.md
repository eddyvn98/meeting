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
| App/API temporarily unavailable | Runner tolerates a short outage, then stops/finalizes capture after MEETING_BOT_CONTROL_OUTAGE_GRACE_MS rather than recording indefinitely without control-plane ownership. |
| Graph outage causes an old occurrence to arrive late | CALENDAR late-grace marks it missed instead of joining much later. |
| Web schedule and Graph describe the same occurrence | URL/time dedupe and advisory lock allow one bot session. |
| Bot joins before everyone else | Initial-alone grace keeps it waiting for a late start. |
| Bot is alone after people have joined | Continuous alone timeout ends the session. |
| Vietnamese Teams roster text | Participant count parser handles common Vietnamese forms. |
| Audio track exists but is silent | Browser RMS health monitor detects prolonged silence. |
| Silent audio while >1 participant is present | Teams audio route is reconnected once per recovery cooldown. |
| Meeting exceeds max duration | Bot ends and finalizes at the configured safety ceiling. |
| Finalize/ffmpeg is slow | Recorder waits up to 11 minutes for finalize, exceeding the server's 10-minute transaction budget so a slow but valid finalize is not falsely marked failed by the runner. |
| Post-processing browser is slow | Processing wait has a bounded timeout and recovery fallback. |
| Runner receives SIGTERM/SIGINT | Runner stops claiming new work; JOINING/LOBBY sessions exit and active CAPTURING sessions finalize before process drain. |
| Teams SPA keeps stale lobby/error text in hidden DOM | A visible in-call Leave/End control wins over body-text heuristics. |

## Default recovery windows

```env
MEETING_BOT_LOBBY_TIMEOUT_MS=900000
MEETING_BOT_RECONNECT_TIMEOUT_MS=120000
MEETING_BOT_REJOIN_WINDOW_MS=120000
MEETING_BOT_REJOIN_ATTEMPT_MS=30000
MEETING_BOT_MAX_CONTINUATIONS=2
MEETING_BOT_CAPTURE_LEASE_TIMEOUT_MS=300000
MEETING_BOT_CONTROL_OUTAGE_GRACE_MS=60000
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
19. Send SIGTERM while the bot is in JOINING/LOBBY; confirm it leaves without waiting for the full lobby timeout.
20. Send SIGTERM during CAPTURING; confirm capture is finalized and no new session is claimed.
21. Block the Meeting API for less than MEETING_BOT_CONTROL_OUTAGE_GRACE_MS and restore it; capture should continue.
22. Block the Meeting API longer than MEETING_BOT_CONTROL_OUTAGE_GRACE_MS; the runner must stop capture rather than continue unmanaged.
23. Use a long recording or deliberately slow ffmpeg so finalize approaches several minutes; confirm the runner does not false-fail at the old 2-minute boundary.
24. Invite a user who never joins Teams; confirm that invited user still receives shared transcript access, per product policy.
25. Verify a recorder token cannot list all meetings, access another meeting, create shares/comments/public links, or mutate voice profiles.
26. Exercise the Teams page with stale lobby/removal/reconnect copy while already joined; visible in-call controls must keep state JOINED.

For every case confirm both the bot-session terminal state and the recorded Meeting result/audio.

## Pre-staging security invariants

These are release blockers, not best-effort checks:

- A recorder token may create exactly one Meeting for its claimed bot session.
- After binding, that token may access only the recorder/STT/diarization endpoints for that Meeting plus read-only voice-profile seeds and stateless live translation.
- The recorder token must not administer bot sessions/schedules, list the owner's meetings, access another Meeting, or create shares/comments/public links.
- Recorder session tokens are bounded: at least six hours, extended to the configured maximum meeting duration plus finalize grace when needed, and capped at 24 hours.
- Calendar/Outlook invitees retain shared transcript access even if they never join the live Teams call; this is intentional product behavior.
- Chromium sandboxing stays enabled by default in production.
- A runner that loses control-plane reachability beyond the configured grace period must fail closed rather than record indefinitely.

## Known staging-only validation

The following cannot be proven by unit/type/build CI and must be exercised on the deployed Linux runner/real Teams tenant:

- Microsoft Teams DOM/wording changes and tenant-specific lobby behavior.
- PulseAudio/PipeWire routing, silence recovery and browser audio device behavior.
- Saved Microsoft session expiry/MFA/conditional-access behavior.
- Long ffmpeg finalize under the staging machine's actual CPU/disk performance.
- Real network interruption, process restart and OS signal handling.
- Memory growth during multi-hour continuous recordings.


## Production hardening added in V9

- Interrupted CAPTURING and STOP_REQUESTED sessions preserve already-uploaded audio as a retryable finalize state instead of making the recording terminal.
- Finalization now claims a short database lease, freezes new audio publication, runs filesystem and ffmpeg work outside the database transaction, and commits PROCESSING only if the lease is still owned. Stale finalize leases can be reclaimed.
- Control-plane outages stop Teams capture and make a bounded best-effort finalize attempt before requesting continuation.
- SIGTERM/SIGINT uses a bounded finalize drain and does not wait for the long post-recording processing loop before process exit.
- Teams microphone/camera state is verified fail-closed before joining and again after joining; ambiguous aria-pressed state is not treated as proof that media is off.
- Playwright is a production dependency and CI verifies it is present in a production dependency graph.
- PulseAudio virtual devices encode their runner PID and startup cleanup only removes modules owned by dead runner processes.
- Teams profile email extraction is scoped to a profile card matching the participant that was clicked.
- Recorder JWT lifetime follows the configured maximum meeting duration plus finalize grace, with a bounded maximum lifetime.
- Saved Teams auth state is required to use owner-only permissions. Optional identity screenshots use owner-only permissions and retention cleanup.
