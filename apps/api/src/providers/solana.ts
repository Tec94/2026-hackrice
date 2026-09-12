import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import { Id, Submission, Timeframe } from "@hackrice/contracts";

// Solana's ClusterType::Devnet genesis identity; an endpoint name alone is insufficient.
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const COMMITMENT_VERSION = "hackrice-analysis-v1";
const hashPattern = /^[0-9a-f]{64}$/;
const CommitmentEnvelope = z.strictObject({
  version: z.literal(1), sessionId: Id, submissionId: Id.optional(), submission: Submission, datasetDigest: z.string().regex(hashPattern),
  cutoffTimeMs: z.number().int().nonnegative().refine((value) => Number.isSafeInteger(value) && value % 3_600_000 === 0), predictionHorizon: Timeframe,
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Salt has the SHA-256 digest width (256 bits); only the digest is published. */
export function createSubmissionSalt(): string {
  return randomBytes(32).toString("hex");
}

export function createCommitment(payload: unknown, saltHex: string): string {
  if (!hashPattern.test(saltHex)) throw new Error("invalid_salt");
  const canonical = canonicalJson(CommitmentEnvelope.parse(payload));
  return createHash("sha256").update(COMMITMENT_VERSION + "\0").update(Buffer.from(saltHex, "hex")).update("\0").update(canonical).digest("hex");
}

export function verifyCommitment(submission: unknown, saltHex: string, expected: string): boolean {
  if (!hashPattern.test(expected)) return false;
  return timingSafeEqual(Buffer.from(createCommitment(submission, saltHex), "hex"), Buffer.from(expected, "hex"));
}

export type SolanaReceipt = {
  network: "devnet";
  commitment: string;
  status: "unavailable" | "pending" | "sent" | "confirmed" | "failed";
  signature?: string;
  /** Private persistence field; never include signed bytes in public DTOs. */
  signedTransactionBase64?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  slot?: number;
  confirmationSource?: "solana_rpc";
  errorCode?: "not_configured" | "wrong_network" | "rpc_unavailable" | "transaction_failed" | "expired" | "invalid_receipt";
};
export type PersistSolanaReceipt = (receipt: SolanaReceipt) => Promise<void>;
export type SolanaRpc = Pick<Connection, "getGenesisHash" | "getLatestBlockhash" | "sendRawTransaction" | "getSignatureStatuses" | "getBlockHeight">;
export type SolanaReceiptConfig = { network: "devnet"; rpcUrl: string; secretKey: Uint8Array; rpc?: SolanaRpc };
export type SolanaReceiptProvider = {
  submit(commitment: string, persistReceipt: PersistSolanaReceipt, previousReceipt?: SolanaReceipt): Promise<SolanaReceipt>;
  confirm(receipt: SolanaReceipt, persistReceipt: PersistSolanaReceipt): Promise<SolanaReceipt>;
};

function assertHash(commitment: string): void {
  if (!hashPattern.test(commitment)) throw new Error("invalid_commitment");
}

export function receiptAllowsReveal(receipt: SolanaReceipt | undefined): boolean {
  return receipt?.network === "devnet" && receipt.status === "confirmed" && receipt.confirmationSource === "solana_rpc"
    && Number.isSafeInteger(receipt.slot) && typeof receipt.signature === "string" && receipt.signature.length > 0;
}

export function createSolanaReceiptProvider(config?: SolanaReceiptConfig): SolanaReceiptProvider {
  if (config && (config.network !== "devnet" || new URL(config.rpcUrl).protocol !== "https:")) throw new Error("invalid_devnet_configuration");
  const signer = config ? Keypair.fromSecretKey(config.secretKey) : undefined;
  const rpc = config ? config.rpc ?? new Connection(config.rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true }) : undefined;

  async function save(receipt: SolanaReceipt, persist: PersistSolanaReceipt): Promise<SolanaReceipt> {
    await persist({ ...receipt });
    return receipt;
  }

  function validateReceipt(receipt: SolanaReceipt): boolean {
    try {
      if (receipt.network !== "devnet" || !hashPattern.test(receipt.commitment) || !receipt.signature || !receipt.signedTransactionBase64
        || !receipt.blockhash || !Number.isSafeInteger(receipt.lastValidBlockHeight)) return false;
      const tx = Transaction.from(Buffer.from(receipt.signedTransactionBase64, "base64"));
      const instruction = tx.instructions[0];
      return tx.verifySignatures() && tx.signature !== null && bs58.encode(tx.signature) === receipt.signature
        && tx.recentBlockhash === receipt.blockhash && tx.feePayer?.equals(signer!.publicKey) === true
        && tx.instructions.length === 1 && instruction?.programId.toBase58() === MEMO_PROGRAM_ID
        && instruction.keys.length === 0 && instruction.data.toString("utf8") === `${COMMITMENT_VERSION}:${receipt.commitment}`;
    } catch { return false; }
  }

  async function confirm(receipt: SolanaReceipt, persist: PersistSolanaReceipt): Promise<SolanaReceipt> {
    assertHash(receipt.commitment);
    if (!rpc || !signer) return save({ network: "devnet", commitment: receipt.commitment, status: "unavailable", errorCode: "not_configured" }, persist);
    if (!validateReceipt(receipt)) return save({ ...receipt, status: "failed", errorCode: "invalid_receipt" }, persist);
    let result: SolanaReceipt;
    try {
      if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return save({ ...receipt, status: "failed", errorCode: "wrong_network" }, persist);
      const response = await rpc.getSignatureStatuses([receipt.signature!], { searchTransactionHistory: true });
      const status = response.value[0];
      if (status?.err) result = { ...receipt, status: "failed", errorCode: "transaction_failed" };
      else if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        result = { ...receipt, status: "confirmed", slot: status.slot, confirmationSource: "solana_rpc" };
        delete result.errorCode;
      } else if (!status && await rpc.getBlockHeight("confirmed") > receipt.lastValidBlockHeight!) {
        result = { ...receipt, status: "failed", errorCode: "expired" };
      } else {
        result = { ...receipt, status: status ? "sent" : receipt.status === "sent" ? "sent" : "pending" };
        delete result.errorCode;
      }
    } catch {
      result = { ...receipt, status: receipt.status === "sent" ? "sent" : "pending", errorCode: "rpc_unavailable" };
    }
    return save(result, persist);
  }

  async function submit(commitment: string, persist: PersistSolanaReceipt, previous?: SolanaReceipt): Promise<SolanaReceipt> {
    assertHash(commitment);
    const unavailable: SolanaReceipt = { network: "devnet", commitment, status: "unavailable", errorCode: "not_configured" };
    if (!rpc || !signer) return save(unavailable, persist);
    if (previous && previous.commitment !== commitment) throw new Error("commitment_conflict");
    let receipt: SolanaReceipt;
    if (previous?.signature) {
      receipt = await confirm(previous, persist);
      if (receipt.status === "confirmed" || receipt.status === "failed") return receipt;
    } else {
      try {
        if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return save({ ...unavailable, errorCode: "wrong_network" }, persist);
        const block = await rpc.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: block.blockhash }).add(new TransactionInstruction({
          programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(`${COMMITMENT_VERSION}:${commitment}`, "utf8"),
        }));
        tx.sign(signer);
        receipt = {
          network: "devnet", commitment, status: "pending", signature: bs58.encode(tx.signature!),
          signedTransactionBase64: tx.serialize().toString("base64"), blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight,
        };
      } catch { return save({ ...unavailable, errorCode: "rpc_unavailable" }, persist); }
    }
    // A persistence failure must abort before any send. Never rebuild bytes after an uncertain send.
    await save({ ...receipt, status: "pending" }, persist);
    let observed: SolanaReceipt;
    try {
      if (await rpc.getGenesisHash() !== DEVNET_GENESIS_HASH) return save({ ...receipt, status: "failed", errorCode: "wrong_network" }, persist);
      const signature = await rpc.sendRawTransaction(Buffer.from(receipt.signedTransactionBase64!, "base64"), { skipPreflight: false, preflightCommitment: "confirmed" });
      observed = signature === receipt.signature ? { ...receipt, status: "sent" } : { ...receipt, status: "pending", errorCode: "rpc_unavailable" };
      if (signature === receipt.signature) delete observed.errorCode;
    } catch {
      // RPC failure is ambiguous: the transaction may already have landed.
      observed = { ...receipt, status: "pending", errorCode: "rpc_unavailable" };
    }
    return save(observed, persist);
  }
  return { submit, confirm };
}
