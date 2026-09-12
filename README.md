# HackRice chart coach

HackRice chart coach is a historical SOL/USDT replay app for practicing chart
analysis without exposing future candles. The repository contains a Next.js
frontend, a TypeScript API, and shared runtime-validated contracts.

Local development uses embedded PostgreSQL through PGlite. Optional integrations
support TigerData, Deepgram with ElevenLabs speech, Backboard learning memory,
and Solana devnet receipts.

## Run locally

Use Node.js with npm workspaces. From the repository root, install dependencies
and create a private local configuration:

```powershell
npm ci
Copy-Item .env.example .env
```

Keep `DATABASE_MODE=local` for credential-free development. Import an explicit
UTC range of Binance SOLUSDT five-minute candles, then start the API:

```powershell
npm run data:import -- 2024-01-01T00:00:00Z 2024-01-03T00:00:00Z
npm run dev
```

In another terminal, start the frontend:

```powershell
npm run dev:frontend
```

Open <http://localhost:3000>. With `.env.example` defaults, the frontend runs on
port 3000 and proxies API traffic to port 4000. Imported data and recordings are
stored under the ignored `.data/` directory.

Provider credentials can remain blank. Typed chart calculations still work,
voice reports unavailable, and reveal stays locked until Solana confirms a
devnet receipt. The runtime does not fabricate provider success.

## Repository layout

The repository is organized into three npm workspaces:

- `frontend/` contains the Next.js interface, replay chart, voice controls, and
  saved-session screens.
- `apps/api/` contains authentication, market data, replay state, provider
  integrations, persistence, and HTTP/WebSocket routes.
- `packages/contracts/` contains the shared Zod schemas, protocol types, and
  safe-reply renderer.

The maintained documentation is:

- [Backend API and operations](docs/backend-api.md), which covers configuration,
  authentication, routes, realtime voice, receipts, retention, and deployment.
- [Design and motion system](docs/design-system.md), which covers the current UI
  tokens, components, accessibility behavior, and `/design-system` reference.

## Verify the repository

Run the backend and shared-contract build and test suite:

```powershell
npm test
```

Run the frontend boundary tests and production build:

```powershell
npm run test:frontend
npm run build:frontend
```

These automated checks use local or injected provider transports. They do not
prove deployed infrastructure, provider retention, live microphone playback,
or a real Solana transaction. The backend guide describes the corresponding
credentialed and manual checks.

## Configure integrations

Start with [`.env.example`](.env.example) and keep secrets out of Git. Deployment
requires the TigerData connection, a persistent Better Auth secret, same-origin
HTTPS routing with WebSocket upgrades, and a private persistent recordings
volume. Run one API process because provider work is coordinated in process.

Voice, Backboard, and Solana remain optional. Keep
`VOICE_PLAYBACK_VALIDATED=false` until a credentialed playback test verifies the
controlled speech route. Store the Solana devnet keypair outside this repository.
Only a salted analysis commitment is written to the Memo program.
