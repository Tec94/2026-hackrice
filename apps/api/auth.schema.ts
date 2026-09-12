import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";

// Schema generation connects to no database and consumes no runtime secrets.
export const auth = betterAuth({
  database: drizzleAdapter(drizzle.mock(), { provider: "pg" }),
  emailAndPassword: { enabled: true },
});
