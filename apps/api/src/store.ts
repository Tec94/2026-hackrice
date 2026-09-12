import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Queryable } from "./database.js";
import { fail, RETENTION_MS, type State } from "./domain.js";
import type { MarketCandle } from "./market.js";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export class Store {
  constructor(public db: Database, public now = () => Date.now()) {}

  async read(userId: string, sessionId: string, tx: Queryable = this.db, lock = false): Promise<State> {
    z.uuid().parse(sessionId);
    const row = (await tx.query("SELECT state,deleting,expires_at FROM replay_sessions WHERE id=$1 AND user_id=$2" + (lock ? " FOR UPDATE" : ""), [sessionId, userId])).rows[0];
    if (!row) return fail("not_found", 404);
    if (row.deleting) return fail("deletion_pending", 410);
    if (new Date(row.expires_at).getTime() <= this.now()) return fail("session_expired", 410);
    return row.state as State;
  }

  async save(tx: Queryable, state: State) {
    await tx.query("UPDATE replay_sessions SET state=$2 WHERE id=$1", [state.public.id, JSON.stringify(state)]);
  }

  async update<T>(userId: string, sessionId: string, fn: (state: State) => T | Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const state = await this.read(userId, sessionId, tx, true);
      const result = await fn(state);
      await this.save(tx, state);
      return result;
    });
  }

  async mutate<T>(userId: string, scope: string, key: string, input: unknown, resourceId: string | undefined,
    fn: (tx: Queryable) => Promise<T>): Promise<T> {
    z.uuid().parse(key);
    const hash = createHash("sha256").update(stableJson(input)).digest("hex");
    return this.db.transaction(async (tx) => {
      // Expiry/deletion checks run before replaying any saved sensitive response.
      if (resourceId) await this.read(userId, resourceId, tx, true);
      await tx.query("INSERT INTO idempotency(user_id,scope,key,request_hash,resource_id,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [userId, scope, key, hash, resourceId ?? null, new Date(this.now() + RETENTION_MS)]);
      const row = (await tx.query("SELECT request_hash,response,expires_at,resource_id FROM idempotency WHERE user_id=$1 AND scope=$2 AND key=$3 FOR UPDATE", [userId, scope, key])).rows[0]!;
      if (row.request_hash !== hash || (resourceId && row.resource_id !== resourceId)) return fail("idempotency_conflict", 409);
      if (new Date(row.expires_at).getTime() <= this.now()) return fail("session_expired", 410);
      if (row.response !== null) {
        if (row.resource_id) await this.read(userId, row.resource_id, tx);
        return row.response as T;
      }
      const response = await fn(tx);
      const linkedId = resourceId ?? (response as any)?.id ?? null;
      await tx.query("UPDATE idempotency SET response=$4,resource_id=$5 WHERE user_id=$1 AND scope=$2 AND key=$3", [userId, scope, key, JSON.stringify(response), linkedId]);
      return response;
    });
  }

  async candles(datasetId: string, tx: Queryable = this.db): Promise<MarketCandle[]> {
    const result = await tx.query("SELECT open_time,close_time,open::text,high::text,low::text,close::text,volume::text FROM candles WHERE dataset_id=$1 ORDER BY open_time", [datasetId]);
    return result.rows.map((r) => ({ openTimeMs: new Date(r.open_time).getTime(), closeTimeMs: new Date(r.close_time).getTime(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  }

  async importDataset(data: { candles: MarketCandle[]; digest: string; source: string }) {
    if (!data.candles.length) return fail("insufficient_data", 409);
    await this.db.transaction(async (tx) => {
      if ((await tx.query("SELECT id FROM datasets WHERE id=$1", [data.digest])).rows.length) return;
      await tx.query("INSERT INTO datasets(id,source,start_time,end_time,candle_count) VALUES($1,$2,$3,$4,$5)", [data.digest, data.source, new Date(data.candles[0]!.openTimeMs), new Date(data.candles.at(-1)!.closeTimeMs), data.candles.length]);
      for (const candle of data.candles) await tx.query("INSERT INTO candles(dataset_id,open_time,close_time,open,high,low,close,volume) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [data.digest, new Date(candle.openTimeMs), new Date(candle.closeTimeMs), candle.open, candle.high, candle.low, candle.close, candle.volume]);
    });
  }
}
