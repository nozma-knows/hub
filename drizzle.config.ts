import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const defaultUrl = `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "postgres"}@localhost:${process.env.POSTGRES_PORT ?? "55432"}/${process.env.POSTGRES_DB ?? "openclaw_hub"}`;
const databaseUrl = process.env.DATABASE_URL ?? defaultUrl;

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
