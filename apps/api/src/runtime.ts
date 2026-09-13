import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";
import { connectDatabase, migrate } from "./database.js";
import { buildApp } from "./server.js";
import { DatabaseRecordings } from "./recordings.js";
import { createSolanaReceiptProvider } from "./providers/solana.js";
import { createBackboardProvider } from "./providers/backboard.js";
import { createAnalysisRater } from "./providers/rater.js";

export async function createApi(env: NodeJS.ProcessEnv = process.env) {
  const settings = await config(env);
  if (settings.local) await mkdir(dirname(settings.localPath), { recursive: true });
  const db = await connectDatabase({ url: settings.databaseURL, local: settings.local, localPath: settings.localPath, allowUnverifiedTLS: settings.allowUnverifiedTLS });
  try {
    await migrate(db);
    const app = await buildApp({ db, recordingsDirectory: settings.recordingsDirectory, baseURL: settings.baseURL,
      ...(settings.recordingsStorage === "database" ? { recordings: new DatabaseRecordings(db) } : {}),
      authSecret: settings.authSecret, voiceConfig: settings.voice,
      solanaProvider: createSolanaReceiptProvider(settings.solana), backboardProvider: createBackboardProvider({ apiKey: settings.backboardApiKey }),
      rater: createAnalysisRater({ deepgramApiKey: settings.voice?.deepgramApiKey, model: settings.voice?.conversationModel }),
      ...(settings.demoCutoffTimeMs === undefined ? {} : { demoCutoffTimeMs: settings.demoCutoffTimeMs }) });
    app.addHook("onClose", async () => { await db.close(); });
    return { app, settings };
  } catch (error) {
    await db.close();
    throw error;
  }
}
