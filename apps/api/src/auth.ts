import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./database.js";
import * as schema from "./db/generated-auth.js";

export function createAuth(db: Database, baseURL: string, secret: string) {
  return betterAuth({
    baseURL, secret,
    database: drizzleAdapter(db.orm, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    trustedOrigins: [new URL(baseURL).origin],
  });
}
