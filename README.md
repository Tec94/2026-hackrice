# HackRice chart coach backend

The shared TypeScript contracts are implemented. Backend services and live
provider integrations are not implemented yet.

Use Node.js with npm workspaces:

```sh
npm ci
npm test
```

The contracts compile to `packages/contracts/dist`. Import their validators,
inferred types, HTTP operation definitions, and voice event schemas from
`@hackrice/contracts` in the future frontend and API workspaces:

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

Read [the backend design](docs/backend-design.md) for the accepted decisions,
HTTP and WebSocket semantics, provider evidence, and remaining integration
requirements. The original architecture is superseded where the user's
September 12 answers change it, especially Backboard, authentication, and the
backend voice relay.

The tests prove contract validation and deterministic reply rendering. They
do not prove database authorization, voice-provider behavior, deployment,
indicator correctness, or end-to-end deletion.
