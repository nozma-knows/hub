import "dotenv/config";

import { env } from "@/lib/env";

// If we got here, env parsing + production secret checks already passed.
// Print a small summary (no secrets) to help operators.
const summary = {
  NODE_ENV: env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  DATABASE_URL: env.DATABASE_URL ? "set" : "missing",
  OPENCLAW_BASE_URL: env.OPENCLAW_BASE_URL,
  OPENCLAW_API_KEY: env.OPENCLAW_API_KEY ? "set" : "missing",
  HUB_SYNC_ENABLED: env.HUB_SYNC_ENABLED,
  HUB_MEDIA_GC_ENABLED: env.HUB_MEDIA_GC_ENABLED,
};

// eslint-disable-next-line no-console
console.log(JSON.stringify(summary, null, 2));
