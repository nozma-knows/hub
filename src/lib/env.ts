import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .default("postgres://postgres:postgres@localhost:55432/openclaw_hub"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be set")
    .default("replace-this-secret-in-production-1234"),
  HUB_ENCRYPTION_KEY: z
    .string()
    .min(1, "HUB_ENCRYPTION_KEY must be set")
    .default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  OPENCLAW_BASE_URL: z.string().url().default("https://api.openclaw.example.com"),
  OPENCLAW_API_KEY: z.string().min(1).default("replace-me"),
  OPENCLAW_SDK_PACKAGE: z.string().default("@openclaw/sdk"),
  OPENCLAW_TIMEOUT_MS: z.coerce.number().default(15000),
  OPENCLAW_RETRIES: z.coerce.number().default(3),
  OPENCLAW_CIRCUIT_THRESHOLD: z.coerce.number().default(5),
  OPENCLAW_CIRCUIT_COOLDOWN_MS: z.coerce.number().default(30000),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SCOPES: z.string().default("channels:read,chat:write,users:read"),
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  LINEAR_SCOPES: z.string().default("read,write")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment variables:\n${issues}`);
}

export const env = parsed.data;
