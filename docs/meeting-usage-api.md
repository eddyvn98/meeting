# Meeting usage API

Meeting records paid usage in its own database so a separate web module can
display per-user consumption without needing access to OpenRouter or Dify
billing.

## What is tracked

### STT

Every accepted paid request to `/api/meeting/[meetingId]/transcribe-fast`
creates one durable usage row before the upstream provider is called.

Tracked fields include:

- authenticated Meeting user
- live/final purpose
- job/chunk/attempt for final transcription retries
- raw PCM bytes and calculated audio duration
- provider-reported duration when available
- model/provider, latency, status and provider request id
- provider-reported cost when available

Live preview, final transcription and retries are separate paid attempts. Do
not infer provider usage from `Meeting.durationSec`.

### Dify AI

Every Dify request is tracked by:

- authenticated/caller user
- Dify app role: `meeting_processing` or `meeting_qa`
- feature such as `translation`, `summary`, `minutes`, `ask_meeting`
- request attempt
- requested model selector and provider-reported model when available
- input/output/total tokens
- provider-reported price and currency when available
- latency, HTTP status, request/workflow ids and final status

The code never estimates Dify price when the upstream response does not report
one.

## Retry and fallback policy

Blocking Dify requests retry once in the same app for network errors, HTTP
408/429/5xx, invalid JSON, or an empty usable answer. Authentication and other
non-retriable 4xx responses fail immediately.

All Meeting AI calls use the workflow configured by `MEETING_AI_KEY` and
`MEETING_AI_URL`; Meeting uses its dedicated workflow. Ask Meeting,
Ask Group, section generation, and mindmap generation have explicit task routes
in the exported workflow. If a primary answer is empty or invalid, these tasks
retry through the workflow's Qwen fallback node. Its model is configured in
the Dify workflow export, not selected by passing a model name at runtime.

Live translation uses the workflow's `translate_turbo` route as its single-line
fallback. Set `MEETING_DIFY_TRANSLATION_FALLBACK_ENABLED=true` to enable model
fallback for live single-line and batch translation; the batch fallback uses a
separate DeepSeek LLM node. Other blocking processing tasks use transport
retries only. Arbitrary runtime model selectors are not supported by this
workflow.
Publish the task routes and fallback nodes in the configured Meeting Dify app
for Q&A fallback to take effect.

Streaming requests retry only before any text has been emitted. Once partial
text reaches the caller, the request is not replayed automatically because
that could duplicate captions/content.

## Read-only API

Set:

```env
MEETING_USAGE_API_TOKEN=replace-with-a-long-random-secret
```

Call from the backend of the separate usage web module:

```http
GET /api/meeting/usage
Authorization: Bearer <MEETING_USAGE_API_TOKEN>
```

`x-meeting-usage-token` is also accepted. Do not expose this token in
browser JavaScript.

### Query parameters

- `from`: ISO timestamp, inclusive; defaults to current UTC month start
- `to`: ISO timestamp, exclusive; defaults to now
- `userEmail`: optional exact normalized Meeting user email
- `purpose`: optional STT purpose such as `live` or `final`
- `app`: optional Dify app role
- `feature`: optional AI feature
- `includeEvents=true`: include recent request-level audit records
- `limit`: event count per usage type, default 100, maximum 500

### Response shape

```json
{
  "generatedAt": "2026-10-05T00:00:00.000Z",
  "period": { "from": "...", "to": "..." },
  "stt": {
    "totals": {
      "requestCount": 0,
      "audioDurationMs": 0,
      "providerDurationMs": 0
    },
    "byUser": [],
    "byPurpose": []
  },
  "ai": {
    "totals": {
      "requestCount": 0,
      "inputTokens": 0,
      "outputTokens": 0,
      "totalTokens": 0,
      "priceByCurrency": {}
    },
    "byUser": [],
    "byApp": [],
    "byFeature": [],
    "byModel": []
  }
}
```

Prices are grouped by currency rather than blindly summed across currencies.
