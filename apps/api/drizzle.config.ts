import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/generated-auth.ts",
  out: "./migrations/auth",
});
