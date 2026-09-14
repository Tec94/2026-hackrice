import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import * as authSchema from "./db/generated-auth.js";

export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
export interface Database extends Queryable {
  orm: ReturnType<typeof pgDrizzle> | ReturnType<typeof liteDrizzle>;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  mode: "tigerdata" | "local";
}

export function postgresOptions(url: string, allowUnverifiedTLS = false): pg.PoolConfig {
  if (!allowUnverifiedTLS) return { connectionString: url };
  const connection = new URL(url);
  // Explicit hackathon opt-in: encrypted transport without server identity verification.
  // pg connection-string SSL parameters override the separate ssl object.
  for (const name of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) connection.searchParams.delete(name);
  return { connectionString: connection.toString(), ssl: { rejectUnauthorized: false } };
}

export async function connectDatabase(options: { url?: string; localPath?: string; local?: boolean; allowUnverifiedTLS?: boolean }): Promise<Database> {
  if (options.local) {
    const client = new PGlite(options.localPath ?? "memory://");
    await client.waitReady;
    return {
      mode: "local", orm: liteDrizzle(client, { schema: authSchema }),
      query: (sql, params) => client.query(sql, params), exec: (sql) => client.exec(sql),
      transaction: (fn) => client.transaction((tx) => fn({ query: (s, p) => tx.query(s, p), exec: (s) => tx.exec(s) })),
      close: () => client.close(),
    };
  }
  if (!options.url) throw new Error("DATABASE_URL is required for TigerData. Use DATABASE_MODE=local explicitly for local development.");
  const pool = new pg.Pool(postgresOptions(options.url, options.allowUnverifiedTLS));
  return {
    mode: "tigerdata", orm: pgDrizzle(pool, { schema: authSchema }),
    query: async (sql, params) => ({ rows: (await pool.query(sql, params)).rows }),
    exec: (sql) => pool.query(sql),
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn({ query: async (sql, params) => ({ rows: (await client.query(sql, params)).rows }), exec: (sql) => client.query(sql) });
        await client.query("COMMIT");
        return value;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}

export async function migrate(db: Database) {
  await db.exec("CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const folder = new URL("../migrations/auth/", import.meta.url);
  for (const file of (await readdir(folder)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.transaction(async (tx) => {
      if ((await tx.query("SELECT name FROM app_migrations WHERE name=$1", [file])).rows.length) return;
      await tx.exec(await readFile(new URL(file, folder), "utf8"));
      await tx.query("INSERT INTO app_migrations(name) VALUES($1)", [file]);
    });
  }
  const name = "application-v1";
  if (!(await db.query("SELECT name FROM app_migrations WHERE name=$1", [name])).rows.length) {
    await db.transaction(async (tx) => {
      await tx.exec(await readFile(new URL("../migrations/application.sql", import.meta.url), "utf8"));
      await tx.query("INSERT INTO app_migrations(name) VALUES($1)", [name]);
    });
  }
  if (db.mode === "tigerdata") {
    await db.exec("CREATE EXTENSION IF NOT EXISTS timescaledb");
    await db.query("SELECT create_hypertable('candles','open_time',if_not_exists=>true,migrate_data=>true)");
  }
  await db.transaction(async (tx) => {
    if ((await tx.query("SELECT name FROM app_migrations WHERE name=$1", ["recordings-v1"])).rows.length) return;
    await tx.exec(await readFile(new URL("../migrations/recordings.sql", import.meta.url), "utf8"));
    await tx.query("INSERT INTO app_migrations(name) VALUES($1)", ["recordings-v1"]);
  });
}
