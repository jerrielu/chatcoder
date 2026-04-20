import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "@chatcoder/shared";
import { hashApiKey, type Session, type SessionsRepo } from "../db/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    session: Session;
  }
}

export interface AuthDeps {
  sessionsRepo: SessionsRepo;
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
 * Installs an onRequest hook on `app` that authenticates any request whose
 * URL begins with `opts.protectedPrefix`. We attach the hook directly (not
 * through a plugin) because Fastify plugins run in their own encapsulated
 * scope, which would prevent the hook from seeing routes registered on the
 * parent app.
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
    const session = await opts.sessionsRepo.getByApiKeyHash(hashApiKey(raw));
    if (!session) throw ApiError.unauthorized();
    if (session.status === "revoked") throw ApiError.sessionRevoked();
    req.session = session;
  });
}
