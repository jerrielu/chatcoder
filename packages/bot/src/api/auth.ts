import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "@chatcoder/shared";
import { hashApiKey } from "../db/crypto.js";
import type { ApiKeyRecord, ApiKeysRepo } from "../db/apiKeys.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKey: ApiKeyRecord;
  }
}

export interface AuthDeps {
  apiKeysRepo: ApiKeysRepo;
  /** Paths that should be authenticated (prefix match). */
  protectedPrefix: string;
  /** Sub-prefixes inside `protectedPrefix` that should bypass bearer auth. */
  skipPrefixes?: string[];
}

export function extractBearer(req: FastifyRequest): string | null {
  const h = req.headers["authorization"];
  if (!h || typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}

/**
 * Installs an onRequest hook that authenticates daemon requests by api_key.
 * Sessions are resolved per-request inside the handlers because a single
 * daemon may have many sessions concurrently.
 */
export function installAuth(app: FastifyInstance, opts: AuthDeps): void {
  const skipPrefixes = opts.skipPrefixes ?? [];
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith(opts.protectedPrefix)) return;
    for (const skip of skipPrefixes) {
      if (req.url.startsWith(skip)) return;
    }
    const raw = extractBearer(req);
    if (!raw) throw ApiError.unauthorized("Missing bearer token");

    const rec = await opts.apiKeysRepo.getByHash(hashApiKey(raw));
    if (!rec) throw ApiError.unauthorized();
    if (rec.status === "revoked") throw ApiError.sessionRevoked();
    req.apiKey = rec;
  });
}
