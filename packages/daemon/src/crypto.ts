import { createHash, randomBytes } from "node:crypto";
import { API_KEY_PREFIX, API_KEY_RAND_BYTES } from "@chatcoder/shared";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { rawApiKey: string; hash: string; prefix: string } {
  const raw = API_KEY_PREFIX + randomBytes(API_KEY_RAND_BYTES).toString("base64url");
  return { rawApiKey: raw, hash: hashApiKey(raw), prefix: raw.slice(0, 8) };
}
