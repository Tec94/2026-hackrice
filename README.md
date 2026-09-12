# HackRice chart coach backend

The TypeScript backend and frontend-shared contracts are implemented. The
credential-free local flow runs on embedded PostgreSQL (PGlite); deployment
uses TigerData PostgreSQL and TimescaleDB. No frontend is included.

Use Node.js with npm workspaces (verified locally with Node 26.5.0):

```sh
npm ci
npm test
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
The API listens at the address in `.env`; `/health` reports its database mode.
There is no browser page at `/` yet.

With blank provider settings, typed chart calculations work, voice reports
unavailable, and reveal remains locked because no devnet receipt is confirmed.
Tests inject provider transports to exercise the full reveal and cleanup flow;
the runtime does not contain a fake-confirmation bypass.

## Integration and deployment

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

TigerData connectivity, Deepgram/ElevenLabs audible playback, Backboard remote
acknowledgments, and actual Solana devnet transactions remain unverified until
credentials are configured. The app is not deployed.

The dependency audit reports eight moderate transitive/direct-chain advisories.
The reported esbuild development server, stream-json filter, and UUID v3/v5/v6
buffer paths are not used by this API; no forced breaking dependency downgrade
was applied. This is not a claim that every dependency is vulnerability-free.

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
