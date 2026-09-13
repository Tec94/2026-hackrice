import { createApi } from "./runtime.js";

const { app, settings } = await createApi();
await app.jobs.run();
const address = await app.listen({ host: settings.host, port: settings.port });
console.log(`Chart coach API listening at ${address} (${app.replayService.store.db.mode}).`);
if (settings.demoCutoffTimeMs !== undefined) {
  console.log(`Demo mode: every new session cuts at ${new Date(settings.demoCutoffTimeMs).toISOString()}.`);
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
