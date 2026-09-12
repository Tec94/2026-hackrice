import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import {
  COMMITMENT_VERSION, DEVNET_GENESIS_HASH, MEMO_PROGRAM_ID, createCommitment, createSolanaReceiptProvider,
  createSubmissionSalt, receiptAllowsReveal, verifyCommitment,
} from "../dist/providers/solana.js";

const submission = {
  chartSnapshotId: "11111111-1111-4111-8111-111111111111", thesis: "Private thesis text", prediction: "higher",
  hypotheticalAction: "wait", confidencePercent: 50, claimedEvidence: ["close > 1"],
};
const salt = "01".repeat(32);
const envelope = { version: 1, sessionId: "33333333-3333-4333-8333-333333333333", submissionId: "22222222-2222-4222-8222-222222222222", submission,
  datasetDigest: "03".repeat(32), cutoffTimeMs: 3600000, predictionHorizon: "1h" };
const commitment = createCommitment(envelope, salt);
function harness(overrides = {}) {
  const events = [];
  const keypair = Keypair.fromSeed(new Uint8Array(32).fill(7));
  const rpc = {
    getGenesisHash: async () => DEVNET_GENESIS_HASH,
    getLatestBlockhash: async () => { events.push("blockhash"); return { blockhash: new PublicKey(new Uint8Array(32).fill(9)).toBase58(), lastValidBlockHeight: 10 }; },
    sendRawTransaction: async (bytes) => { events.push({ send: Buffer.from(bytes).toString("base64") }); return bs58.encode(Transaction.from(bytes).signature); },
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [null] }),
    getBlockHeight: async () => 1,
    ...overrides,
  };
  const provider = createSolanaReceiptProvider({ network: "devnet", rpcUrl: "https://api.devnet.solana.com", secretKey: keypair.secretKey, rpc });
  const persist = async (receipt) => { events.push({ receipt: { ...receipt } }); };
  return { provider, persist, events, rpc };
}

test("commitments are canonical, deterministic, salted, and bind the submitted content", () => {
  const reordered = Object.fromEntries(Object.entries(envelope).reverse());
  assert.equal(commitment, createCommitment(reordered, salt));
  assert.match(commitment, /^[0-9a-f]{64}$/);
  assert.notEqual(commitment, createCommitment({ ...envelope, submission: { ...submission, thesis: "Changed" } }, salt));
  assert.notEqual(commitment, createCommitment(envelope, "02".repeat(32)));
  assert.equal(verifyCommitment(envelope, salt, commitment), true);
  assert.equal(verifyCommitment({ ...envelope, submission: { ...submission, confidencePercent: 51 } }, salt, commitment), false);
  assert.throws(() => createCommitment(envelope, ""));
  assert.match(createSubmissionSalt(), /^[0-9a-f]{64}$/);
});

test("the envelope also commits to the dataset, cutoff, horizon, and submission identity", () => {
  assert.notEqual(createCommitment(envelope, salt), createCommitment({ ...envelope, predictionHorizon: "5m" }, salt));
  assert.notEqual(createCommitment(envelope, salt), createCommitment({ ...envelope, cutoffTimeMs: 7200000 }, salt));
  assert.notEqual(createCommitment(envelope, salt), createCommitment({ ...envelope, sessionId: "44444444-4444-4444-8444-444444444444" }, salt));
  assert.throws(() => createCommitment({ ...envelope, cutoffTimeMs: 3600001 }, salt));
});

test("unconfigured receipt provider performs no network call and cannot manufacture confirmation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected network access"); };
  try {
    const receipts = [];
    const provider = createSolanaReceiptProvider();
    const result = await provider.submit(commitment, async (receipt) => receipts.push(receipt));
    assert.equal(result.status, "unavailable");
    assert.equal(result.errorCode, "not_configured");
    assert.equal(result.signature, undefined);
    const fake = { network: "devnet", commitment, status: "confirmed", signature: "mock" };
    assert.equal(receiptAllowsReveal(fake), false);
    assert.equal((await provider.confirm(fake, async (receipt) => receipts.push(receipt))).status, "unavailable");
    assert.ok(receipts.every((receipt) => !receiptAllowsReveal(receipt)));
  } finally { globalThis.fetch = originalFetch; }
});

test("wrong-network RPC cannot submit, even when its configured URL says devnet", async () => {
  const { provider, persist, events } = harness({ getGenesisHash: async () => "another-network" });
  const receipt = await provider.submit(commitment, persist);
  assert.equal(receipt.errorCode, "wrong_network");
  assert.equal(receipt.status, "unavailable");
  assert.equal(events.some((event) => event.send), false);
});

test("signed bytes and derived signature are persisted before the first send", async () => {
  const { provider, persist, events } = harness();
  const receipt = await provider.submit(commitment, persist);
  const sentIndex = events.findIndex((event) => event.send);
  const stored = events[sentIndex - 1].receipt;
  assert.equal(stored.status, "pending");
  assert.equal(stored.signature, receipt.signature);
  assert.equal(stored.signedTransactionBase64, events[sentIndex].send);
  assert.equal(receipt.status, "sent", "A mocked send is never a confirmed receipt");
  assert.equal(receiptAllowsReveal(receipt), false);
  const tx = Transaction.from(Buffer.from(stored.signedTransactionBase64, "base64"));
  assert.equal(tx.instructions.length, 1);
  assert.equal(tx.instructions[0].programId.toBase58(), MEMO_PROGRAM_ID);
  assert.equal(tx.instructions[0].data.toString(), `${COMMITMENT_VERSION}:${commitment}`);
  assert.equal(tx.instructions[0].data.includes(Buffer.from(submission.thesis)), false);
});

test("failed pending persistence prevents transmission", async () => {
  const { provider, events } = harness();
  await assert.rejects(provider.submit(commitment, async () => { throw new Error("Database unavailable"); }));
  assert.equal(events.some((event) => event.send), false);
});

test("an ambiguous send stays pending and an explicit retry reuses the saved bytes", async () => {
  const { provider, persist, events, rpc } = harness({ sendRawTransaction: async () => { throw new Error("Lost RPC response"); } });
  const pending = await provider.submit(commitment, persist);
  assert.equal(pending.status, "pending");
  assert.equal(pending.errorCode, "rpc_unavailable");
  assert.ok(pending.signature && pending.signedTransactionBase64);
  rpc.sendRawTransaction = async (bytes) => { events.push({ send: Buffer.from(bytes).toString("base64") }); return pending.signature; };
  const retried = await provider.submit(commitment, persist, pending);
  assert.equal(retried.signature, pending.signature);
  assert.equal(events.find((event) => event.send).send, pending.signedTransactionBase64);
  assert.equal(events.filter((event) => event === "blockhash").length, 1);
  assert.equal(receiptAllowsReveal(retried), false);
});

test("processed transactions and absent signatures remain blocked; expiry is explicit failure", async () => {
  const { provider, persist, rpc } = harness();
  const sent = await provider.submit(commitment, persist);
  rpc.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 0, err: null, confirmationStatus: "processed" }] });
  const processed = await provider.confirm(sent, persist);
  assert.equal(processed.status, "sent");
  assert.equal(receiptAllowsReveal(processed), false);
  rpc.getSignatureStatuses = async () => ({ context: { slot: 11 }, value: [null] });
  rpc.getBlockHeight = async () => 11;
  const expired = await provider.confirm(sent, persist);
  assert.equal(expired.status, "failed");
  assert.equal(expired.errorCode, "expired");
});

test("persisted receipt bytes must match the commitment, signature, signer, and Memo program", async () => {
  const { provider, persist } = harness();
  const sent = await provider.submit(commitment, persist);
  const invalid = await provider.confirm({ ...sent, commitment: "04".repeat(32) }, persist);
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.errorCode, "invalid_receipt");
  assert.equal(receiptAllowsReveal(invalid), false);
});
