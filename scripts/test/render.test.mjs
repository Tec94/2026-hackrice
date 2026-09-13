import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("production entry serves Next pages, assets, and authenticated API on one port", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chartroom-render-"));
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: { ...process.env, NODE_ENV: "production", SERVE_FRONTEND: "true", DATABASE_MODE: "local", DATABASE_URL: "",
      LOCAL_DATABASE_PATH: join(directory, "postgres"), RECORDINGS_STORAGE: "database", APP_URL: "http://localhost:3000",
      HOST: "127.0.0.1", PORT: "0", BETTER_AUTH_SECRET: "render-smoke-test-secret-not-for-deployment",
      DEEPGRAM_API_KEY: "", ELEVENLABS_API_KEY: "", ELEVENLABS_VOICE_ID: "", DEEPGRAM_THINK_URL: "",
      BACKBOARD_API_KEY: "", SOLANA_DEVNET_RPC_URL: "", SOLANA_DEVNET_KEYPAIR_PATH: "", DEMO_CUTOFF: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
    await rm(directory, { recursive: true, force: true });
  });
  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
  const address = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Server exited (${code}): ${output}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /Chartroom frontend and API listening at (http:\/\/[^\s]+)/.exec(output);
      if (match) resolve(match[1]);
    });
  });
  const homepage = await fetch(address);
  assert.equal(homepage.status, 200);
  const html = await homepage.text();
  assert.match(html, /FIanal\.sim/);
  const asset = /src="([^\"]+\/_next\/[^\"]+\.js[^\"]*|\/_next\/[^\"]+\.js[^\"]*)"/.exec(html)?.[1];
  assert.ok(asset, "The production page must include a Next.js bundle");
  const javascript = await fetch(new URL(asset.replaceAll("&amp;", "&"), address));
  assert.equal(javascript.status, 200);
  assert.match(javascript.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(`${address}/sign-in`)).status, 200);
  const health = await fetch(`${address}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  assert.equal((await fetch(`${address}/api/sessions`)).status, 401);
  assert.equal((await fetch(`${address}/api/auth/get-session`)).status, 200);
  assert.equal((await fetch(`${address}/internal/not-a-route`)).status, 404);
});
