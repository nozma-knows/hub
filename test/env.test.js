import { describe, expect, test } from "bun:test";

describe("env", () => {
  test("fails closed on placeholder secrets in production", async () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://postgres:postgres@localhost:55432/openclaw_hub",
      BETTER_AUTH_SECRET: "replace-this-secret-in-production-1234",
      HUB_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      OPENCLAW_BASE_URL: "http://localhost:18789",
      OPENCLAW_API_KEY: "replace-me",
    };

    // Import with a clean module context by spawning a subprocess.
    const proc = Bun.spawn({
      cmd: ["bun", "-e", `process.env=${JSON.stringify(env)}; await import('./src/lib/env.ts');`],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    expect(code).not.toBe(0);
    expect(stderr).toMatch(/Invalid production secrets/i);
  });
});
