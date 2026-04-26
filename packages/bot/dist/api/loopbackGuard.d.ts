import type { FastifyInstance } from "fastify";
/**
 * Gate a URL prefix to loopback callers. Non-loopback peers get a 404 rather
 * than a 403 so the admin surface is effectively invisible from the outside.
 * Fastify's `inject()` (via light-my-request) defaults remoteAddress to
 * "127.0.0.1", so in-process tests pass without extra setup.
 */
export declare function installLoopbackGuard(app: FastifyInstance, prefix: string): void;
//# sourceMappingURL=loopbackGuard.d.ts.map