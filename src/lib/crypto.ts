import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function resolveKey(): Buffer {
  try {
    const parsed = Buffer.from(env.HUB_ENCRYPTION_KEY, "base64");
    if (parsed.length === 32) {
      return parsed;
    }
  } catch {
    // noop
  }

  const raw = Buffer.from(env.HUB_ENCRYPTION_KEY, "utf8");
  if (raw.length === 32) {
    return raw;
  }

  return createHash("sha256").update(raw).digest();
}

const key = resolveKey();

export function encryptString(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptString(payload: string): string {
  const [iv, tag, encrypted] = payload.split(".");
  if (!iv || !tag || !encrypted) {
    throw new Error("Malformed encrypted payload");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}
