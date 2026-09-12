import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import type { VoiceConfig } from "./providers/voice.js";
import type { SolanaReceiptConfig } from "./providers/solana.js";

export async function config(env: NodeJS.ProcessEnv = process.env) {
  const local = env.DATABASE_MODE === "local";
  if (env.DATABASE_MODE && !["local", "tigerdata"].includes(env.DATABASE_MODE)) throw new Error("DATABASE_MODE must be local or tigerdata.");
  const baseURL = z.url().parse(env.APP_URL);
  const appURL = new URL(baseURL);
  const loopbackHTTP = appURL.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(appURL.hostname);
  if (appURL.protocol !== "https:" && !loopbackHTTP) throw new Error("APP_URL must use HTTPS except on loopback for local testing.");
  if (env.DATABASE_ALLOW_UNVERIFIED_TLS && !["true", "false"].includes(env.DATABASE_ALLOW_UNVERIFIED_TLS)) throw new Error("DATABASE_ALLOW_UNVERIFIED_TLS must be true or false.");
  if (!local && !env.DATABASE_URL) throw new Error("DATABASE_URL is required for TigerData.");
  if (!local && !env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required outside explicit local mode.");
  // Better Auth requires at least 32 characters. Ephemeral local secrets invalidate login cookies on restart.
  const authSecret = env.BETTER_AUTH_SECRET || randomBytes(32).toString("hex");
  if (authSecret.length < 32) throw new Error("BETTER_AUTH_SECRET must satisfy Better Auth's 32-character minimum.");
  const voiceFields = [env.DEEPGRAM_API_KEY, env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID, env.DEEPGRAM_THINK_URL];
  let voice: VoiceConfig | undefined;
  if (voiceFields.some(Boolean) && !voiceFields.every(Boolean)) throw new Error("Voice configuration is incomplete; supply all voice fields or leave all blank.");
  if (voiceFields.every(Boolean)) voice = {
    deepgramApiKey: env.DEEPGRAM_API_KEY!, elevenLabsApiKey: env.ELEVENLABS_API_KEY!,
    elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID!, thinkEndpointUrl: env.DEEPGRAM_THINK_URL!,
    playbackValidated: env.VOICE_PLAYBACK_VALIDATED === "true",
    ...(env.VOICE_CONVERSATION_MODEL ? { conversationModel: env.VOICE_CONVERSATION_MODEL } : {}),
  };
  let solana: SolanaReceiptConfig | undefined;
  if (!!env.SOLANA_DEVNET_RPC_URL !== !!env.SOLANA_DEVNET_KEYPAIR_PATH) throw new Error("Set both Solana devnet RPC URL and keypair path, or neither.");
  if (env.SOLANA_DEVNET_RPC_URL && env.SOLANA_DEVNET_KEYPAIR_PATH) {
    const secret = z.array(z.number().int().min(0).max(255)).parse(JSON.parse(await readFile(resolve(env.SOLANA_DEVNET_KEYPAIR_PATH), "utf8")));
    solana = { network: "devnet", rpcUrl: env.SOLANA_DEVNET_RPC_URL, secretKey: Uint8Array.from(secret) };
  }
  return {
    local, databaseURL: env.DATABASE_URL, allowUnverifiedTLS: env.DATABASE_ALLOW_UNVERIFIED_TLS === "true", localPath: resolve(env.LOCAL_DATABASE_PATH ?? ".data/postgres"),
    recordingsDirectory: resolve(env.RECORDINGS_PATH ?? ".data/recordings"), baseURL, authSecret, voice, solana,
    backboardApiKey: env.BACKBOARD_API_KEY,
    port: z.coerce.number().int().min(0).max(65535).parse(env.PORT ?? (new URL(baseURL).port || (new URL(baseURL).protocol === "https:" ? 443 : 80))),
    host: env.HOST ?? "127.0.0.1",
  };
}
