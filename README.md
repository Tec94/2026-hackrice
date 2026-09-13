# FIanal.sim

FIanal.sim is a historical SOL/USDT replay app for practising chart analysis
without seeing what happened next. It hides the right-hand side of a real chart,
asks you to explain what you see, records your reasoning, and only then reveals
the outcome.

A voice coach answers questions about the visible chart while you think out
loud, and fills in your analysis from what you say. Every number it speaks is
computed by the server from the actual candles; the model chooses words, never
figures. Questions about the future, trading advice, and dated news are refused.

Submitting hashes your analysis to the Solana devnet, so the reasoning you
recorded cannot be quietly edited once the outcome is known.

The repository contains a Next.js frontend, a TypeScript API, and shared
runtime-validated contracts. Local development uses embedded PostgreSQL through
PGlite. Optional integrations support TigerData, Deepgram with ElevenLabs
speech, Backboard learning memory, and Solana devnet receipts.

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

## How a session works

1. **Explore.** The chart stops at a cutoff. Candles past it exist in the
   database but are never sent to the browser, so the future cannot be
   inspected. Change timeframe, add indicators, draw on it.
2. **Ask.** Questions about the visible chart are answered from computed values:
   prices on any candle, indicators, the visible range, and any of those at an
   earlier candle named in bars or in time. Questions with no formula, such as
   the trend or the shape, are described from those same values.
3. **Record.** State a view out loud and the coach writes it into the analysis
   form: prediction, action, confidence, evidence, and what would change your
   mind. You review and edit before submitting.
4. **Commit.** Submitting hashes the analysis and writes that hash to the Solana
   devnet Memo program. Only a salted commitment goes on chain, never the
   analysis itself.
5. **Reveal.** Once the receipt confirms, the hidden candles arrive.

## How it is graded

Two gradings, kept separately and never merged.

At submission the coach judges the **reasoning** with no knowledge of the
outcome: how specific the thesis is, whether the invalidation names something
that would really disprove it, and whether the risk is thought through.

At reveal it judges the **call** against what the price did: whether the market
confirmed the thesis, whether the confidence was calibrated, how the thesis held
up, whether the prediction and action were the right choices.

Both are kept, so a lucky guess never retroactively improves weak reasoning.
Evidence claims are separate again: each is checked arithmetically against the
candles, and a model opinion cannot overturn a comparison that either held or
did not.

## Repository layout

Three npm workspaces:

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

Two flags exist for local preview and are unset by default. `DEMO_CUTOFF` pins
every new session to one cutoff, so the same chart comes up each run; the data,
the calculation, and the grading are unchanged, and the server prints a line at
startup when it is on. `HACKRICE_BYPASS_RECEIPT` opens reveal without a
confirmed receipt and refuses to apply in production. `/health` reports both, so
you can tell what a running server is doing.
