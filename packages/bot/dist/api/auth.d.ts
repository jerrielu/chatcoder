import type { FastifyInstance, FastifyRequest } from "fastify";
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
export declare function extractBearer(req: FastifyRequest): string | null;
/**
 * Installs an onRequest hook that authenticates daemon requests by api_key.
 * Sessions are resolved per-request inside the handlers because a single
 * daemon may have many sessions concurrently.
 */
export declare function installAuth(app: FastifyInstance, opts: AuthDeps): void;
//# sourceMappingURL=auth.d.ts.map