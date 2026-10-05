# Meeting STT usage API

The Meeting app records one usage row for every paid STT request sent through
`/api/meeting/[meetingId]/transcribe-fast`. Tracking is independent of the
provider/API-router billing account and uses the authenticated Meeting user.

## Authentication

Set a dedicated read-only token on the Meeting server:

```env
MEETING_STT_USAGE_API_TOKEN=replace-with-a-long-random-secret
```

The other web app should call this endpoint from its backend, not directly
from browser JavaScript, so the token is never exposed to users.

```http
GET /api/meeting/stt-usage
Authorization: Bearer <MEETING_STT_USAGE_API_TOKEN>
```

`x-meeting-stt-usage-token` is also accepted for service clients that cannot
set an Authorization header.

This token is intentionally separate from `OPENROUTER_API_KEY` and cannot be
used to submit transcription requests.

## Query parameters

- `from`: ISO timestamp, inclusive. Defaults to the first day of the current UTC month.
- `to`: ISO timestamp, exclusive. Defaults to now.
- `userEmail`: optional exact normalized Meeting user email.
- `meetingId`: optional Meeting id.
- `purpose`: optional usage purpose such as `live` or `final`.
- `includeEvents=true`: include recent request-level records.
- `limit`: event limit when `includeEvents=true`, default 100, maximum 500.

## Response

The response includes:

- `totals`: request counts, input bytes, requested audio duration, provider
  duration when reported, and provider-reported cost when available.
- `byUser`: the same core usage metrics grouped by Meeting user.
- `byPurpose`: usage grouped by `live`, `final`, etc.
- `events`: optional request-level records for audit/debugging.

`audioDurationMs` is calculated by Meeting from the actual PCM bytes sent to
the paid route. `providerDurationMs` is populated only when the upstream
provider/router reports a duration.

`providerCostUsd` is never estimated by Meeting. It is populated only when
the upstream response explicitly reports a cost. This avoids presenting an
estimate as provider billing when the Meeting app does not own the billing
account.

## Billing interpretation

A meeting can consume more paid STT audio than its wall-clock duration. Live
preview and final transcription are separate provider requests, and retries
are also recorded individually. For cost attribution, use the request-level
usage ledger rather than `Meeting.durationSec`.

Rows left in `STARTED` indicate that Meeting persisted the request before
contacting the paid provider but did not reach the normal success/failure
finalization path, for example because the server process terminated. Treat
those rows as unresolved usage during reconciliation.
