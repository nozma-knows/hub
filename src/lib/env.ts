import { z } from "zod";

function looksPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;

  const lowered = v.toLowerCase();
  if (lowered.includes("replace") || lowered.includes("placeholder")) return true;
  if (v === "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=") return true;
  if (v === "replace-me") return true;
  if (v === "replace-this-secret-in-production-1234") return true;
  return false;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .default("postgres://postgres:postgres@localhost:55432/openclaw_hub"),

  // Secrets: provide dev defaults for build-time analysis, but fail-closed in production.
  BETTER_AUTH_SECRET: z.string().min(1).default("replace-this-secret-in-production-1234"),
  HUB_ENCRYPTION_KEY: z.string().min(1).default("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),

  OPENCLAW_BASE_URL: z.string().url().default("https://api.openclaw.example.com"),
  OPENCLAW_API_KEY: z.string().min(1).default("replace-me"),
  OPENCLAW_SDK_PACKAGE: z.string().default("@openclaw/sdk"),
  OPENCLAW_TIMEOUT_MS: z.coerce.number().default(15000),
  OPENCLAW_RETRIES: z.coerce.number().default(3),
  OPENCLAW_CIRCUIT_THRESHOLD: z.coerce.number().default(5),
  OPENCLAW_CIRCUIT_COOLDOWN_MS: z.coerce.number().default(30000),
  OPENCLAW_SYNC_INTERVAL_MS: z.coerce.number().default(5 * 60 * 1000),

  HUB_MONITORING_TTL_MS: z.coerce.number().default(10_000),

  // Background tasks: allow turning off periodic loops when running multiple web instances.
  // Default keeps current behavior.
  HUB_SYNC_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() === "true"),
  HUB_MEDIA_GC_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? "true").toLowerCase() === "true"),

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

// Fail-closed in production.
if (parsed.data.NODE_ENV === "production") {
  const secretIssues: string[] = [];
  if (looksPlaceholder(parsed.data.BETTER_AUTH_SECRET) || parsed.data.BETTER_AUTH_SECRET.length < 32) {
    secretIssues.push("BETTER_AUTH_SECRET must be set to a non-placeholder 32+ char value in production");
  }
  if (looksPlaceholder(parsed.data.HUB_ENCRYPTION_KEY)) {
    secretIssues.push("HUB_ENCRYPTION_KEY must be set to a non-placeholder value in production");
  }
  if (looksPlaceholder(parsed.data.OPENCLAW_API_KEY)) {
    secretIssues.push("OPENCLAW_API_KEY must be set to a non-placeholder value in production");
  }

  if (secretIssues.length > 0) {
    throw new Error(`Invalid production secrets:\n${secretIssues.join("\n")}`);
  }
}

export const env = parsed.data;
