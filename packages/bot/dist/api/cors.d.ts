import type { FastifyInstance } from "fastify";
/**
 * CORS for the admin surface only. A request origin is allowed iff its
 * hostname is loopback — any port. This pairs with installLoopbackGuard,
 * which enforces that the peer IP itself is loopback; together they mean
 * only a browser running on the same host can hit /v1/admin/*.
 *
 * Registered globally on the app; daemon routes don't care about CORS
 * because daemon traffic is server-to-server and has no browser origin.
 */
export declare function installAdminCors(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=cors.d.ts.map