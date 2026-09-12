import test from "node:test";
import assert from "node:assert/strict";
import { getSession, safeReturnPath } from "../src/services/auth-client.ts";
import { request } from "../src/services/api-client.ts";
import { createDrawing } from "../src/components/chart/drawings.ts";
import { rsi } from "../src/components/chart/indicators.ts";
import { Id } from "@hackrice/contracts";

test("sign-in return paths stay inside the application", () => {
  for (const path of ["https://example.com", "//example.com", "javascript:alert(1)", "/\\example.com"]) assert.equal(safeReturnPath(path), "/");
  assert.equal(safeReturnPath("/replay/example?test=true"), "/replay/example?test=true");
});
test("drawings use contract UUIDs and flat RSI agrees with the backend", () => {
  assert.ok(Id.safeParse(createDrawing("horizontal", {time: 1, price: 2}, {time: 1, price: 2}).id).success);
  assert.equal(rsi(Array.from({length: 15}, (_, i) => ({ time: i, close: 10 })), 14)[0].value, 50);
});

test("account checks use the current same-origin cookie without cached session data", async () => {
  const original = globalThis.fetch;
  try {
    const user = { id: "test-user", name: "Tester", email: "tester@example.com" };
    let signedIn = true;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/auth/get-session");
      assert.equal(options.credentials, "include");
      assert.equal(options.cache, "no-store");
      return Response.json(signedIn ? { user } : null);
    };
    assert.deepEqual(await getSession(), user);
    signedIn = false;
    assert.equal(await getSession(), null);
  } finally { globalThis.fetch = original; }
});
test("typed requests preserve cookies and mutation idempotency without leaking absolute URLs", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/sessions/00000000-0000-4000-8000-000000000001/questions");
      assert.equal(options.credentials, "include");
      assert.ok(Id.safeParse(options.headers["Idempotency-Key"]).success);
      const body = JSON.parse(options.body);
      assert.equal(body.text, "What is the closing price?");
      return Response.json({turnId:"00000000-0000-4000-8000-000000000002", chartSnapshotId:body.chartSnapshotId});
    };
    const result = await request("askQuestion", {params:{sessionId:"00000000-0000-4000-8000-000000000001"}, body:{chartSnapshotId:"00000000-0000-4000-8000-000000000003",text:"What is the closing price?"}});
    assert.equal(result.turnId, "00000000-0000-4000-8000-000000000002");
  } finally { globalThis.fetch = original; }
});
