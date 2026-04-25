import { createHash, randomBytes } from "node:crypto";
import {
  API_KEY_PREFIX,
  API_KEY_RAND_BYTES,
  MIN_API_KEY_LENGTH
} from "@chatcoder/shared";

export interface GeneratedKey {
  rawApiKey: string;
  hash: string;
  prefix: string;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const raw = API_KEY_PREFIX + randomBytes(API_KEY_RAND_BYTES).toString("base64url");
  return { rawApiKey: raw, hash: hashApiKey(raw), prefix: raw.slice(0, 8) };
}

export function validateUserSuppliedKey(raw: string): void {
  if (!raw || raw.length < MIN_API_KEY_LENGTH) {
    throw new Error(`API key must be at least ${MIN_API_KEY_LENGTH} characters.`);
  }
  if (/\s/.test(raw)) throw new Error("API key may not contain whitespace.");
}
