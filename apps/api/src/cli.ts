import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";
import { connectDatabase, migrate } from "./database.js";
import { ReplayService } from "./service.js";
import { Store } from "./store.js";
import { Jobs } from "./jobs.js";
import { Recordings, DatabaseRecordings } from "./recordings.js";
import { fetchBinanceCandles } from "./market.js";
import { createSolanaReceiptProvider } from "./providers/solana.js";
import { createBackboardProvider } from "./providers/backboard.js";

const settings = await config();
if (settings.local) await mkdir(dirname(settings.localPath), { recursive: true });
const db = await connectDatabase({ url: settings.databaseURL, local: settings.local, localPath: settings.localPath, allowUnverifiedTLS: settings.allowUnverifiedTLS });
try {
  await migrate(db);
  const store = new Store(db);
  if (process.argv[2] === "import") {
    const start = process.argv[3];
    const end = process.argv[4];
    if (!start || !end || !start.endsWith("Z") || !end.endsWith("Z")) throw new Error("Supply explicit UTC start and exclusive end, e.g. npm run data:import -- 2024-01-01T00:00:00Z 2024-01-03T00:00:00Z");
    const dataset = await fetchBinanceCandles({ startTimeMs: Date.parse(start), endTimeMs: Date.parse(end) });
    await store.importDataset(dataset);
    console.log(`Imported ${dataset.candles.length} verified SOLUSDT 5m candles; digest ${dataset.digest}.`);
  } else if (process.argv[2] === "jobs") {
    const recordings = settings.recordingsStorage === "database" ? new DatabaseRecordings(db) : new Recordings(settings.recordingsDirectory);
    const jobs = new Jobs(new ReplayService(store), recordings, createSolanaReceiptProvider(settings.solana), createBackboardProvider({ apiKey: settings.backboardApiKey }));
    try { await jobs.run(); console.log("Provider status and retention sweep finished. Pending provider work remains pending."); }
    finally { await jobs.close(); await recordings.close(); }
  } else if (process.argv[2] === "migrate") console.log(`Migrations applied (${db.mode}).`);
  else throw new Error("Expected migrate, import, or jobs.");
} finally { await db.close(); }
