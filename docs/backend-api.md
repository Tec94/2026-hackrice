# Backend API and operations

The TypeScript API provides authenticated SOL/USDT replay sessions, deterministic
chart calculations, private history, controlled voice, learning-memory jobs,
and Solana devnet receipts. The shared
[contracts](../packages/contracts/src/index.ts) define JSON validation and event
types. This guide is the source of truth for the implemented backend and its
operational boundaries.

## Start locally

Run commands from the repository root. The local verification used Node.js
26.5.0. The scripts require a Node.js runtime supporting
`--env-file-if-exists`.

For a fresh checkout without an existing `.env`, run:

```powershell
npm ci
Copy-Item .env.example .env
npm run db:migrate
npm run data:import -- 2024-01-01T00:00:00Z 2024-01-02T00:00:00Z
npm run dev
```

Preserve an existing `.env`. The import command makes a live request for the
explicit UTC interval, with an exclusive end, and validates canonical Binance
SOLUSDT 5-minute candles before storage. It stores source metadata and a digest;
reimporting the same digest does not duplicate rows. No candles are fabricated
when the provider is unavailable. A session requires enough complete history
for the configured indicators and its chosen prediction horizon.

The example configuration serves the API at `http://localhost:4000`, while the
frontend runs at `http://localhost:3000` and proxies API traffic.
`GET /health` reports the database mode and whether voice playback is enabled.
The API does not serve a frontend; route frontend requests and WebSocket upgrades
through the same origin in an integrated deployment.

`DATABASE_MODE=local` explicitly selects PGlite, an embedded PostgreSQL runtime.
It requires no database credentials and persists to `.data/postgres` by default.
It is a local development path, not proof of a TigerData connection or Timescale
hypertable. Stop the API before running CLI commands against the same local
database directory.

## Configure deployment

The [environment example](../.env.example) lists the supported keys. Secrets
remain server-side; do not commit `.env` or a Solana keypair file.

| Key | Implemented behavior |
| --- | --- |
| `DATABASE_MODE` | `local` or `tigerdata`; omission uses the hosted path. |
| `DATABASE_URL` | Required for TigerData; ordinary PostgreSQL connection URL passed to `pg`. |
| `LOCAL_DATABASE_PATH` | PGlite directory; defaults to `.data/postgres`. |
| `APP_URL` | Required public origin; HTTPS is required outside local mode. |
| `BETTER_AUTH_SECRET` | Required outside local mode; Better Auth requires at least 32 characters. A blank local value creates an ephemeral secret, invalidating cookies on restart. |
| `HOST`, `PORT` | Listen address; host defaults to `127.0.0.1`, port derives from `APP_URL` unless supplied. |
| `RECORDINGS_PATH` | Private PCM directory; defaults to `.data/recordings`. Use persistent storage, never a public static directory. |
| `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `DEEPGRAM_THINK_URL` | Supply all together or leave all blank. The Think URL must be public HTTPS pointing to this API's `/internal/think`. |
| `VOICE_PLAYBACK_VALIDATED` | Only the exact value `true` enables configured voice. Keep false until credentialed tests establish the controlled speech path. |
| `BACKBOARD_API_KEY` | Optional learning-memory integration. |
| `SOLANA_DEVNET_RPC_URL`, `SOLANA_DEVNET_KEYPAIR_PATH` | Supply both or neither. RPC must use HTTPS; keypair path names a local JSON secret-key array. Only devnet is supported. |

For TigerData, set the hosted keys and run `npm run db:migrate`. Migrations
create the Better Auth and application tables, enable `timescaledb`, and turn
the candle table into a hypertable. The database role must permit those
operations. The connection uses the supplied PostgreSQL URL, including its TLS
configuration; the application does not replace it with an insecure fallback.

Run one API process with persistent WebSocket support and a private persistent
recording volume. Provider-work serialization is in-process, not a distributed
worker lock. Do not run a concurrent CLI job worker against the same application
state. Deployment and live TigerData access have not been verified by the local
integration test.

## Authenticate and call the API

Better Auth owns `/api/auth/*`. Sign up with
`POST /api/auth/sign-up/email` using JSON `{name,email,password}`, or sign in at
`POST /api/auth/sign-in/email` using `{email,password}`. Retain its session
cookie. Resource access is scoped to the authenticated account; an inaccessible
resource returns 404 without disclosing its owner.

Mutation requests must send an `Origin` matching `APP_URL`'s origin. Use a UUID
`Idempotency-Key` for session creation, context updates, questions, submissions,
reveal, reflection, and completion. An identical retry returns the recorded
response; a different body or resource using that operation's key returns
409 `idempotency_conflict`. Deletion is already keyed by the owned session.
Receipt refresh and learning retrieval do not require an idempotency header.

Successful creation and submission return 201; accepted questions and deletion
return 202; other successful JSON operations return 200. Errors contain only
`{code,requestId}`, not provider messages. Missing authentication returns 401,
invalid origin 403, invalid input 400, missing/inaccessible resources 404,
state or revision conflicts 409, and expired or deleting sessions 410 while
their local row remains. After removal, those resources return 404.

| Operation | Method and path |
| --- | --- |
| Create/list sessions | `POST` / `GET /api/sessions` |
| Archive/restore session | `PUT /api/sessions/:sessionId/archive` with `{archived: boolean}` |
| Read/delete session | `GET` / `DELETE /api/sessions/:sessionId` |
| Read/save chart snapshot | `GET` / `PATCH /api/sessions/:sessionId/chart-context` |
| Complete candles | `GET /api/sessions/:sessionId/chart/bars?timeframe=5m&from=-60&to=0` |
| Indicator series | `GET /api/sessions/:sessionId/chart/indicators?chartSnapshotId=<uuid>` |
| Ask typed question | `POST /api/sessions/:sessionId/questions` |
| Commit analysis | `POST /api/sessions/:sessionId/submissions` |
| Read evaluation | `GET /api/evaluations/:evaluationId` |
| Read/refresh receipt | `GET /api/sessions/:sessionId/receipt`, `POST /api/sessions/:sessionId/receipt/refresh` |
| Read learning codes | `POST /api/sessions/:sessionId/learning` |
| Reveal/complete | `POST /api/sessions/:sessionId/reveal`, `POST /api/sessions/:sessionId/complete` |
| Save reflection | `PUT /api/sessions/:sessionId/reflection` |
| Read history | `GET /api/sessions/:sessionId/history` |
| Download private PCM | `GET /api/sessions/:sessionId/recordings/:recordingId` |
| Read deletion status | `GET /api/deletions/:deletionId` |

Create a session with explicit `timeframe` and `predictionHorizon`, each one of
`5m`, `15m`, or `1h`. Context updates must include the current
`expectedRevision`; stale updates fail. Each accepted update creates an
immutable snapshot. Questions and submissions reference a snapshot belonging
to that session. Older owned snapshots remain usable; changing the current
chart does not change their calculation inputs.

Before reveal, chart times are relative minute offsets: zero is the closed UTC
hour cutoff, negative values are history. Bars end at or before zero; a request
extending into the future is clipped, and a future-only request returns no
bars. Five-minute source rows also produce complete 15-minute and 1-hour bars.
The API omits real market dates, source metadata, and outcome fields before
reveal. Session creation/expiry timestamps are account-history metadata, not
market dates. Prices and computed values travel as decimal strings.

Typed questions use a supported calculation/concept parser, not unrestricted
chat generation. Assistant output is a structured `SafeReply`; display it with
`renderSafeReply`. User text remains attributed input in history, never assistant
prose. Evaluation findings use evidence statuses and reason codes; educational
scores are not calibrated probabilities of a price outcome.

## Connect realtime and controlled voice

Connect to `WS /api/sessions/:sessionId/events` with the session cookie and
matching origin. Wait for `session.ready`. JSON messages use the shared
`ClientEvent` / `ServerEvent` schemas, including UUID event/session/turn IDs,
snapshot references, and server sequence numbers. `question.text` uses the same
calculation and persistence operation as HTTP questions.

For voice, send `voice.start` with the negotiated format and frozen snapshot,
then wait for `voice.ready` before microphone frames. Binary frames contain the
turn UUID's 16 bytes followed by complete mono signed 16-bit little-endian PCM;
use `encodeAudioFrame` and `decodeAudioFrame`. The current server negotiates
16 kHz. `assistant.audio.start` identifies output, and every binary output
frame still carries its turn ID. `assistant.interrupt` cancels that turn.
Generation completion is not playback completion: send
`assistant.playback.completed` only after playback actually finishes.

Reconnect with `session.resume` and `afterSequence`. Structured events can be
replayed; deduplicate by event ID. Raw audio is not replayed.

Deepgram calls the backend-owned `/internal/think` endpoint with an opaque,
single-use bearer token bound to the active turn and snapshot. The callback
authorizes that binding, calculates on the allowed slice, validates `SafeReply`,
and returns only `renderSafeReply` text in an OpenAI-compatible response. There
is no managed Think fallback, unrestricted assistant prose, or unmanaged
greeting. No browser receives provider keys. Missing configuration or an
unvalidated playback flag leaves voice unavailable; typed chart questions
still work.

This boundary controls text sent to synthesis. It does not establish that
neural TTS reproduces every audible word exactly. Credentialed Deepgram and
ElevenLabs tests, including interruption and failed callback behavior, remain
required before enabling playback.

## Confirm a devnet receipt before reveal

The lifecycle is `exploring -> submitted -> revealed -> completed`. Submission
freezes the user's analysis, evaluation, and salted commitment. The commitment
binds the session, submission, dataset digest, cutoff, and horizon. Only the
versioned hash enters a Solana Memo transaction; no thesis, transcript, recording,
account identity, or salt is published.

Receipt work starts after submission. Refresh it explicitly through the receipt
refresh route. The provider verifies the RPC's devnet genesis hash, signs and
persists transaction bytes before sending, and reuses those bytes after an
ambiguous send. `pending` or `sent` is not confirmation. Reveal requires a
persisted matching receipt observed as confirmed/finalized by Solana RPC;
failed, missing, unavailable, or merely sent transactions cannot unlock it.

Without Solana configuration, the receipt is `unavailable` and reveal stays
blocked. Local mode does not fabricate a receipt. After successful reveal,
the receipt exposes the commitment proof for verification and chart access
extends only through the fixed prediction horizon. No real assets are traded.
The on-chain hash is public and cannot be erased by deleting application history.

## Retention, learning memory, and cleanup

The requested retention is up to 30 days or deletion on click. Replay sessions
expire 30 days after creation; linked history, final transcripts, evaluations,
and facts become unreadable at that deadline. Raw microphone PCM is private
on disk with its own expiry metadata; session expiry can deny access sooner.
Recordings are returned only through the authenticated binary route, not a
permanent storage URL. Cancelled turns may have no final transcript.

Backboard receives only schema-validated category/reason codes and source session
IDs, under a separate assistant per user. It never receives raw audio,
transcripts, market dates, prices, or outcomes. Retrieval uses `Readonly`; only
validated codes enter API responses. The current learning route returns records
whose sources belong to the user's surviving sessions, not arbitrary prose.
Retrieval threads are tracked against every source that they may contain, so
deleting any source also deletes its tracked retrieval copies.
Missing credentials return unavailable; ambiguous operations stay pending.

Deleting a session blocks reads and cancels voice, removes local content and
recordings, and separately requests removal of tracked Backboard memories and
threads. An accepted deletion may remain pending after local removal. Check
its deletion ID: `completed` requires local records and recordings to be
`deleted`, with Backboard `deleted` or `not_used`. Unknown provider resource IDs
or unfinished operations cannot establish completion. Pending sync work must
not recreate deleted content.

Startup runs a cleanup/provider-status sweep; expiry schedules another sweep
from stored deadlines. To explicitly revisit pending work with the API stopped:

```powershell
npm run jobs:run
```

Deleting application copies does not prove erasure from provider logs or backups.
Deepgram uses `mip_opt_out: true`; disabling agent history is not a global
retention guarantee. ElevenLabs receives controlled assistant text. Provider
retention arrangements and any account-specific zero-retention settings require
separate verification. Backboard deletion acknowledgments cover tracked
resources, not an independently verified provider-backup purge.

## Verify locally

Run the focused end-to-end test after building:

```powershell
npm run build
node --test apps/api/test/integration.test.mjs
```

The test uses in-memory PGlite, real Better Auth cookies, synthetic candles,
temporary private PCM, and provider mocks. It covers HTTP/WebSocket ownership,
idempotency, stale revision rejection, snapshot-linked replies, hidden-future
boundaries, provider-confirmed receipt gating, and deletion/expiry read denial.
Its Solana provider uses a mocked RPC that changes from pending to confirmed;
no real transaction or live voice/memory call is made. Run `npm test` for the
whole repository test suite. These checks do not prove deployed TigerData,
provider retention, or live speech behavior.


## Design-system integration

The archive operation is authenticated, owner-scoped, and idempotent. It stores an
optional `archived` flag inside the existing session JSON, so existing databases
need no new table migration. Listing returns both active and archived records;
the UI selects the requested view. Archive and restore preserve the four-state
lifecycle and the original expiry. Archive never invokes deletion jobs.

`GET chart-context` accepts an optional `chartSnapshotId` for any owned frozen
snapshot. History includes owned snapshots and the calculated fact records used
by turns and evidence findings. Before reveal, those still contain only relative
past offsets and no source dates or future prices. Chart-context inputs may carry
optional `appearance` (visual indicator IDs and drawing anchors). Appearance is
saved for rendering; the existing `indicators` and `drawings` fields remain the
calculator inputs. This keeps visual-only overlays out of coach calculations.

New sessions initialize the visible EMA 21. Explicit evidence may compare a
supported metric with a decimal or another supported metric of the same unit,
for example `close > ema 21`. Unsupported comparisons and prose remain not
assessable. Compound supported coach questions such as `RSI 14 and close` return
both computed facts from one snapshot. The new UI shows findings and reason
codes without presenting an overall score. The preexisting optional rating
endpoints remain available; their scores are not rendered by the new screens.

Flat is the existing exact equality between the horizon close and cutoff close.
The UI never interprets the illustrative ±0.25% band as policy. Free-text
invalidation remains unassessed. Reflection is read back on completed-session
review. A voice failure now releases the microphone; ordinary turn completion
retains it only while the user keeps the conversation open.

For local testing, set `HACKRICE_BYPASS_RECEIPT=true` in the API environment and
restart the API. `/health` exposes `receiptBypassEnabled`, which the feedback
screen uses to enable reveal without offering receipt retries. The session must
still belong to the caller and have a submitted analysis. Receipt status stays
unchanged. The bypass is disabled when `NODE_ENV=production` or the flag is off;
no separate frontend flag is required.
