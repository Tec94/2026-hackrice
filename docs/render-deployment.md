# Render deployment

The root `render.yaml` deploys the Next.js frontend and Fastify API as one
**Free** Node.js web service. Fastify owns the public port, including the
authenticated WebSocket upgrade route. Page and asset requests go to Next.js
on an OS-assigned loopback port in the same process.

## Create the service

1. Push this deployment configuration to the GitHub repository.
2. In Render, select **New > Blueprint**, connect `Tec94/2026-hackrice`, and
   select the branch containing `render.yaml`.
3. Supply `DATABASE_URL` using the existing TigerData PostgreSQL connection.
   Confirm that the service plan is **Free**, then deploy.

The Blueprint installs build dependencies, runs `npm run build:render`, and
starts `npm run start:render`. Leave the root directory at the repository root.
There is no Wrangler deploy command. Node 24.18.0 matches the successful
dependency installation in the supplied Cloudflare build log.

Render supplies `PORT` and `RENDER_EXTERNAL_URL`. The API uses that external
URL as `APP_URL` unless you explicitly set `APP_URL` for a custom domain.
`BETTER_AUTH_SECRET` is generated once by the Blueprint. `SERVE_FRONTEND=true`
disables Next's development API rewrites during the build; Fastify serves API
requests directly. `RECORDINGS_STORAGE=database` commits incoming audio frames
to PostgreSQL instead of Render's temporary filesystem.

## Existing database and optional providers

The service runs idempotent migrations on startup, including recording storage
tables. The database role needs the permissions described in `backend-api.md`.
Existing imported candles stay in TigerData. If that database has no candles,
run the documented import command locally against the same database with an
explicit UTC range. Deployment never invents market data or a demo range.

To enable voice, add `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`, and set `DEEPGRAM_THINK_URL` to the deployed HTTPS URL
plus `/internal/think`. Supply all four together. Set `VOICE_PLAYBACK_VALIDATED`
to `true` only after the documented playback validation. `BACKBOARD_API_KEY`
and `VOICE_CONVERSATION_MODEL` remain optional.

For Solana receipts, supply `SOLANA_DEVNET_RPC_URL` and upload the existing
devnet keypair as a Render secret file, then set `SOLANA_DEVNET_KEYPAIR_PATH`
to its mounted path. Do not put keypair contents in the repository. Without a
configured receipt provider, production reveal remains locked; the local
receipt bypass is disabled in production.

## Verify

```powershell
npm test
npm run test:frontend
$env:SERVE_FRONTEND = 'true'
npm run build:frontend
npm run test:render
```

The Render smoke test uses an isolated local database and no provider keys.
It starts the production entry and checks the homepage, JavaScript bundle,
sign-in route, health, and API authentication. The API integration suite checks
authenticated WebSockets with the frontend proxy registered. The recording
test closes and reopens storage, checks exact audio bytes, and verifies deletion.

After deployment, verify `/health`, sign in, create a replay from the imported
data, and verify the browser connects to `/api/sessions/<id>/events` on the same
host. Live voice and Solana confirmation require their actual credentials.

## Free hosting boundaries

Render Free services sleep after 15 minutes without inbound traffic and can
take about a minute to wake. The workspace shares 750 free running hours per
month. These are Render's published limits, not application settings. No
persistent disk or Render PostgreSQL subscription is requested by this Blueprint.

PostgreSQL recording storage consumes the existing TigerData storage and
connection capacity. It preserves the API's authenticated reads and deletion
workflow. Expiry cleanup runs while the service is active and again at startup;
a sleeping service cannot run background cleanup. Expired sessions are denied
access before cleanup. Hosting being free does not establish that TigerData or
voice/AI provider usage is free. Their billing remains separate.

Sources: [Render Free](https://render.com/docs/free),
[Blueprint specification](https://render.com/docs/blueprint-spec),
[WebSockets](https://render.com/docs/websocket).
