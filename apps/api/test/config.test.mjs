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
