import { describe, expect, test } from "bun:test";

// Ensure env loads with non-prod defaults.
process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "x".repeat(32);
process.env.HUB_ENCRYPTION_KEY = "b".repeat(32);
process.env.OPENCLAW_API_KEY = "test-key";
process.env.OPENCLAW_BASE_URL = "http://localhost:18789";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

const { encryptString, decryptString } = await import("../src/lib/crypto");

describe("crypto", () => {
  test("encrypt/decrypt roundtrip", () => {
    const input = "hello secret world";
    const enc = encryptString(input);
    expect(enc).toContain(".");
    const dec = decryptString(enc);
    expect(dec).toBe(input);
  });

  test("decrypt rejects malformed payload", () => {
    expect(() => decryptString("nope")).toThrow(/Malformed/);
  });
});
