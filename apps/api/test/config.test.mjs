import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../dist/config.js";
import { postgresOptions } from "../dist/database.js";

test("unverified database TLS requires explicit opt-in and cannot disable encryption", async () => {
  const url = "postgres://example.invalid/db?sslmode=disable";
  assert.deepEqual(postgresOptions(url), { connectionString: url });
  const options = postgresOptions(url, true);
  assert.deepEqual(options.ssl, { rejectUnauthorized: false });
  assert.equal(new URL(options.connectionString).searchParams.has("sslmode"), false);
  const env = { DATABASE_MODE: "tigerdata", DATABASE_URL: url, BETTER_AUTH_SECRET: "a".repeat(32), APP_URL: "http://localhost:3000" };
  assert.equal((await config(env)).allowUnverifiedTLS, false);
  assert.equal((await config({ ...env, DATABASE_ALLOW_UNVERIFIED_TLS: "true" })).allowUnverifiedTLS, true);
  await assert.rejects(config({ ...env, APP_URL: "http://example.com" }), /HTTPS/);
  await assert.rejects(config({ ...env, DATABASE_ALLOW_UNVERIFIED_TLS: "yes" }), /true or false/);
});

test("Render derives the public origin and validates persistent recording storage", async () => {
  const env = { DATABASE_MODE: "tigerdata", DATABASE_URL: "postgres://example.invalid/db", BETTER_AUTH_SECRET: "a".repeat(32),
    RENDER_EXTERNAL_URL: "https://chartroom.onrender.com", PORT: "10000", RECORDINGS_STORAGE: "database" };
  const settings = await config(env);
  assert.equal(settings.baseURL, env.RENDER_EXTERNAL_URL);
  assert.equal(settings.port, 10000);
  assert.equal(settings.recordingsStorage, "database");
  assert.equal((await config({ ...env, APP_URL: "https://custom.example" })).baseURL, "https://custom.example");
  await assert.rejects(config({ ...env, RECORDINGS_STORAGE: "temporary" }));
});
