import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";
import { connectDatabase, migrate } from "./database.js";
import { buildApp } from "./server.js";
import { createSolanaReceiptProvider } from "./providers/solana.js";
import { createBackboardProvider } from "./providers/backboard.js";

const settings = await config();
if (settings.local) await mkdir(dirname(settings.localPath), { recursive: true });
const db = await connectDatabase({ url: settings.databaseURL, local: settings.local, localPath: settings.localPath, allowUnverifiedTLS: settings.allowUnverifiedTLS });
await migrate(db);
const app = await buildApp({ db, recordingsDirectory: settings.recordingsDirectory, baseURL: settings.baseURL,
  authSecret: settings.authSecret, voiceConfig: settings.voice,
  solanaProvider: createSolanaReceiptProvider(settings.solana), backboardProvider: createBackboardProvider({ apiKey: settings.backboardApiKey }) });
await app.jobs.run();
const address = await app.listen({ host: settings.host, port: settings.port });
console.log(`Chart coach API listening at ${address} (${db.mode}).`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await db.close();
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
