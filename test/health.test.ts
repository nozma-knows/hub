import { describe, expect, test } from "bun:test";

(process.env as any).NODE_ENV = "test";
(process.env as any).NEXT_PUBLIC_APP_URL = "http://localhost:3000";
(process.env as any).OPENCLAW_BASE_URL = "http://localhost:18789";
(process.env as any).OPENCLAW_API_KEY = "test";
(process.env as any).BETTER_AUTH_SECRET = "x".repeat(32);
(process.env as any).HUB_ENCRYPTION_KEY = "b".repeat(32);

// Prevent background loops from starting when importing the app in tests.
(process.env as any).HUB_SYNC_ENABLED = "false";
(process.env as any).HUB_MEDIA_GC_ENABLED = "false";
(process.env as any).HUB_DISPATCHER_ENABLED = "false";

describe("/api/health", () => {
  test("returns a JSON payload even if DB is unavailable", async () => {
    const { honoApp } = await import("@/server/hono");

    const res = await honoApp.request("/api/health");
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("timestamp");
    expect(json).toHaveProperty("dbOk");
    expect(json).toHaveProperty("dispatcher");
    expect(typeof json.dispatcher.enabled).toBe("boolean");
  });
});
