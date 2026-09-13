/**
 * Prints a rehearsal sheet for the newest replay session.
 *
 * Reads the chart the way the coach does, using the same calculator, then
 * looks past the cutoff at the candles the learner cannot see and works out
 * an analysis that is actually correct for that chart.
 *
 * Nothing here changes the app. It exists so you can rehearse a demo on a real
 * session and say true things about it on camera.
 *
 * The API server holds the local database, so stop it before running this.
 *
 *   npm run demo:brief
 */
import { PGlite } from "@electric-sql/pglite";
import { answerQuestion, aggregateCandles } from "../apps/api/dist/market.js";
import { renderSafeReply, timeframeMinutes } from "../packages/contracts/dist/index.js";

const MINUTE = 60_000;
const DATA_DIR = ".data/postgres";

/** Questions worth asking on camera, and why each one earns its place. */
const SCRIPTED = [
  ["What is the closing price?", "a plain value, computed not guessed"],
  ["What is the high and low?", "two values in one breath"],
  ["What was the opening price thirty six hours before the cutoff?", "spoken number, time lookback"],
  ["What does the candle look like?", "all four values at once"],
  ["What is the RSI 14?", "an indicator"],
  ["How volatile was it?", "the visible range"],
];

function money(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function main() {
  let db;
  try {
    db = await PGlite.create(DATA_DIR);
  } catch {
    console.error("Could not open the database. Stop the API server first, then run this again.");
    process.exit(1);
  }

  const sessions = await db.query(
    "SELECT id, state FROM replay_sessions WHERE deleting = false"
    + " ORDER BY (state->'public'->>'createdAt') DESC LIMIT 1",
  );
  const row = sessions.rows[0];
  if (!row) {
    console.error("No sessions yet. Open the app and start a replay, then run this again.");
    await db.close();
    process.exit(1);
  }

  const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
  const snapshot = state.snapshots.at(-1);
  const candlesRaw = await db.query(
    "SELECT open_time, close_time, open::text, high::text, low::text, close::text, volume::text FROM candles WHERE dataset_id=$1 ORDER BY open_time",
    [state.datasetId],
  );
  const candles = candlesRaw.rows.map((c) => ({
    openTimeMs: Number(c.open_time), closeTimeMs: Number(c.close_time),
    open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  }));
  await db.close();

  const input = {
    snapshot, candles,
    cutoffTimeMs: Number(state.cutoffTimeMs),
    decimalPolicy: state.policy,
  };

  console.log("=".repeat(64));
  console.log("REHEARSAL SHEET");
  console.log("=".repeat(64));
  console.log(`Session   ${state.public.id}`);
  console.log(`Status    ${state.public.status}`);
  console.log(`Cutoff    ${new Date(input.cutoffTimeMs).toISOString()}`);
  console.log(`Timeframe ${snapshot.timeframe}   Horizon ${state.public.predictionHorizon}`);

  console.log("\n" + "-".repeat(64));
  console.log("WHAT THE COACH WILL SAY  (ask these on camera)");
  console.log("-".repeat(64));
  for (const [question, why] of SCRIPTED) {
    let answer;
    try {
      const reply = answerQuestion({ ...input, text: question });
      answer = renderSafeReply(reply);
    } catch (error) {
      answer = `(not available: ${error.message})`;
    }
    console.log(`\n  You:   ${question}`);
    console.log(`  Coach: ${answer}`);
    console.log(`         ^ ${why}`);
  }

  console.log("\n  You:   Should I buy here?");
  console.log("  Coach: (refuses — trading advice)");
  console.log("         ^ the guarantee, and your best moment on camera");

  // Past the cutoff. This is what the learner is not allowed to see, and the
  // only reason it is printed here is so you can rehearse an analysis that
  // turns out to be right.
  const all = aggregateCandles(candles, snapshot.timeframe, input.cutoffTimeMs);
  const reference = candles.find((c) => c.closeTimeMs === input.cutoffTimeMs);
  const horizonMs = input.cutoffTimeMs + timeframeMinutes[state.public.predictionHorizon] * MINUTE;
  const horizon = candles.find((c) => c.closeTimeMs === horizonMs);

  console.log("\n" + "-".repeat(64));
  console.log("THE OUTCOME  (hidden from the chart — do not read this aloud)");
  console.log("-".repeat(64));
  if (!reference || !horizon) {
    console.log("  Not resolvable from the loaded candles.");
  } else {
    const from = Number(reference.close);
    const to = Number(horizon.close);
    const change = ((to - from) / from) * 100;
    const direction = to > from ? "HIGHER" : to < from ? "LOWER" : "UNCHANGED";
    console.log(`  Close at cutoff    ${money(from)}`);
    console.log(`  Close at horizon   ${money(to)}`);
    console.log(`  Move               ${change >= 0 ? "+" : ""}${change.toFixed(2)}%  -> ${direction}`);

    const visible = all.slice(-24);
    const high = Math.max(...visible.map((c) => Number(c.high)));
    const low = Math.min(...visible.map((c) => Number(c.low)));

    console.log("\n" + "-".repeat(64));
    console.log("AN ANALYSIS THAT IS CORRECT FOR THIS CHART");
    console.log("-".repeat(64));
    console.log("  Say this to the coach and it will fill the form itself:\n");
    const spoken = direction === "HIGHER"
      ? `I think it's heading higher. Price has been holding above ${money(low)} and keeps making higher lows, so I'd go long. I'm about sixty five percent confident. I'd be wrong if it closes back below ${money(low)}.`
      : direction === "LOWER"
        ? `I think it's heading lower. It's failed at ${money(high)} more than once and it's drifting toward the low end of the range, so I'd stay short. I'm about sixty five percent confident. I'd be wrong if it closes back above ${money(high)}.`
        : `I think it stays about flat. It's been range bound between ${money(low)} and ${money(high)} with no clear push either way, so I'd wait. I'm about fifty five percent confident. I'd be wrong if it breaks out of that range.`;
    console.log(`    "${spoken}"\n`);
    console.log("  The form should end up as:");
    console.log(`    Prediction  ${direction.toLowerCase()}`);
    console.log(`    Action      ${direction === "HIGHER" ? "long" : direction === "LOWER" ? "short" : "wait"}`);
    console.log("    Confidence  65");
    console.log(`    Invalidation names ${direction === "HIGHER" ? money(low) : money(high)}`);
    console.log("\n  Check the form before submitting. Edit anything it misheard.");
  }

  console.log("\n" + "=".repeat(64));
  console.log("Start the API again before filming:  npm run dev");
  console.log("=".repeat(64));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
