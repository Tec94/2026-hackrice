# HackRice chart coach backend

The TypeScript backend and frontend-shared contracts are implemented. The
credential-free local flow runs on embedded PostgreSQL (PGlite); deployment
uses TigerData PostgreSQL and TimescaleDB. The Next.js frontend includes
authentication, replay charts, typed questions, and saved analysis feedback.

Use Node.js with npm workspaces (verified locally with Node 26.5.0):

```sh
npm ci
npm test
npm run test:frontend
npm run build:frontend
```

## Run locally

Copy `.env.example` to `.env`, keeping `DATABASE_MODE=local`. Credentials can
remain blank. Import an explicit UTC range, then start the API:

```sh
npm run data:import -- 2024-01-01T00:00:00Z 2024-01-03T00:00:00Z
npm run dev
```

That example range was fetched successfully: 576 genuine Binance SOLUSDT
five-minute candles. It is an example, not a built-in range or history quota.
The importer rejects missing/inconsistent data instead of fabricating candles.
Migrations run at startup. Local files are private under ignored `.data/`.
The API listens on port 4000 with the example configuration. In another
terminal, run `npm run dev:frontend` and open <http://localhost:3000>.
The frontend forwards `/api/*`, `/health`, and `/internal/think` to the API.
Keep `APP_URL=http://localhost:3000` for this local flow.

With blank provider settings, typed chart calculations work, voice reports
unavailable, and reveal remains locked because no devnet receipt is confirmed.
Tests inject provider transports to exercise the full reveal and cleanup flow;
the runtime does not contain a fake-confirmation bypass.

## Integration and deployment

For UI polish, open `/design-system` and read the
[design and motion guide](docs/design-system.md).

Read [the frontend API guide](docs/backend-api.md) for authentication, requests,
voice frames, playback acknowledgments, examples, and error handling. Read
[the design](docs/backend-design.md) for the safety boundary and source evidence.

Configure these locally when ready; never paste secrets into chat:

- TigerData `DATABASE_URL`, `DATABASE_MODE=tigerdata`, HTTPS `APP_URL`, and a
  persistent Better Auth secret.
- Deepgram and ElevenLabs keys, an ElevenLabs voice ID, and the public HTTPS
  `/internal/think` callback URL. Keep `VOICE_PLAYBACK_VALIDATED=false` until
  credentialed playback testing verifies the controlled speech route.
- Backboard API key.
- Solana devnet RPC URL and the path to a funded devnet keypair JSON file
  stored outside this repository. Only a salted digest reaches the Memo program.

For local TigerData testing, the loopback `APP_URL` can use HTTP. This
checkout's private configuration uses TigerData, not the embedded database.
The owner explicitly approved `DATABASE_ALLOW_UNVERIFIED_TLS=true` for this
hackathon database. It keeps database traffic encrypted but does not verify
the server's identity; interception can expose credentials and data. The
example configuration defaults to `false`. This option does not change TLS
verification for other providers.

If you expose the frontend through ngrok, forward port 3000 and set `APP_URL`
to that public HTTPS origin before restarting the API. Keep the Think callback
at that origin's `/internal/think` path. Merely visiting `/` on the API port
does not load the frontend.

Build with `npm run build`, then run `npm start`. Deploy one API process behind
same-origin HTTPS routing for the frontend, API, and WebSocket upgrade path.
Set `HOST` to the deployment listener address. Mount a private persistent
volume at `RECORDINGS_PATH`; do not serve it statically. Do not use an ephemeral
serverless filesystem or run multiple API replicas with this MVP coordinator.

Retention runs at startup and at the next stored expiry. While the process is
stopped it cannot erase files; the next start sweeps expired data before
listening. `npm run jobs:run` performs a provider-status and retention sweep
when the API process is stopped. Receipt refresh is also an explicit HTTP
operation. There is no guessed polling interval or silent retry count.

## Verification boundaries

`npm test` builds both workspaces and tests calculations, schema validation,
real Better Auth login against local PostgreSQL, cross-user access, HTTP and
WebSocket flows, immutable snapshots, receipt gating, interrupted output,
recording deletion, and expiry. Provider tests use injected transports.

TigerData connectivity and encrypted transport were verified with 576 imported
SOLUSDT candles in a Timescale hypertable. Live HTTP testing through the
frontend proxy verified sign-up, session creation, timeframe changes, typed
questions, submission, saved evaluation, and the unconfirmed-receipt gate.
The backend suite passes 52 tests; the frontend boundary suite passes 6 tests.
The production frontend build passes.

Browser testing verified sign-up, a populated replay chart, and enabled voice
controls. The live Deepgram-to-Think-to-ElevenLabs route generated the approved
refusal, and the owner listened to and confirmed the complete output before
enabling `VOICE_PLAYBACK_VALIDATED=true` in the private configuration.
Authenticated frontend WebSocket startup and cancellation also passed live.
Actual browser microphone and device playback testing remain a manual check.

Backboard confirmed six stored learning records. Live retrieval exposed a
`memory` versus `content` response-field mismatch, now fixed and regression
tested. Retrieval returned all six records, with source links tracked in
TigerData. Provider-side deletion and pending-operation recovery were not
tested live in this pass. Solana remains unconfigured, so live reveal and
completion remain locked.

Development writes `.next-dev`; production builds write `.next`. This prevents
a production build from invalidating chunks in a running development server.

The dependency audit reports nine moderate advisories and one high advisory.
The high advisory is in Next.js's transitive PostCSS dependency. A dependency
upgrade and public-deployment security review are not completed in this pass.
The reported esbuild development server, stream-json filter, and UUID v3/v5/v6
buffer paths are not used by this API; no forced breaking dependency downgrade
was applied. This is not a claim that every dependency is vulnerability-free.

## Manual testing

Use the current design and test the real typed flow at <http://localhost:3000>:

1. Create a test account and start a crypto replay.
2. Switch timeframes, pan the chart, and select a historical candle.
3. Ask "What is the closing price?" and verify a numerical response. Ask for
   future prices or trading advice and verify a refusal.
4. Enter a thesis and confidence, review the confirmation, and submit once.
5. Verify that feedback contains the saved evidence review, not a fabricated
   overall grade. Refresh the page to check persistence.
6. Verify the unavailable Solana receipt keeps reveal disabled. Do not bypass
   this gate to demonstrate an outcome.
7. Select **Retrieve learning records** to check Backboard's live status and
   returned learning categories.

For a voice turn, select **Start microphone**, grant microphone access, wait
for **listening**, and ask a chart question. Select **Stop and send** when
finished. Verify the transcript, spoken response, and saved conversation.
**Cancel / stop playback** stops capture and queued audio. Changing pages also
releases the microphone. Audio is never sent before the provider is ready.

To repeat the isolated provider validation, stop the API (leave the frontend
and callback tunnel running), then run:

```sh
node --env-file=.env apps/api/scripts/validate-voice.mjs
```

The script temporarily serves only the Think callback on the configured API
port, generates a synthetic question using ElevenLabs, and saves approved
response audio to ignored `.data/voice-validation.wav`. It does not change the
database or enable voice automatically. Listen to the file and then restart
the API with `npm start`. Do not change the playback-validation flag based
only on mocked tests.

EMA 21, RSI 14, horizontal lines, and trend lines are sent to the coach when
asking or submitting. Other chart overlays are visual-only. The landing chart
is explicitly illustrative, not a live feed. Receipt confirmation, reveal,
and completion require the remaining Solana configuration.

The contracts compile to `packages/contracts/dist`. Import their validators,
inferred types, HTTP operation definitions, and voice event schemas from
`@hackrice/contracts` in the frontend and API workspaces:

```ts
import {
  httpContracts,
  ServerEvent,
  renderSafeReply,
  type ServerMessage,
} from "@hackrice/contracts";

const request = httpContracts.createSession.body.parse({
  timeframe: "15m",
  predictionHorizon: "1h",
});

// Validate incoming data before treating it as a typed message.
const event: ServerMessage = ServerEvent.parse(incomingData);
if (event.type === "assistant.response") {
  const text = renderSafeReply(event.reply);
}
```

The original architecture is superseded where the user's September 12 answers
change it, especially Backboard, authentication, and the backend voice relay.
