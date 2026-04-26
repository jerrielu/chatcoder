const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
/**
 * Gate a URL prefix to loopback callers. Non-loopback peers get a 404 rather
 * than a 403 so the admin surface is effectively invisible from the outside.
 * Fastify's `inject()` (via light-my-request) defaults remoteAddress to
 * "127.0.0.1", so in-process tests pass without extra setup.
 */
export function installLoopbackGuard(app, prefix) {
    app.addHook("onRequest", async (req, reply) => {
        if (!req.url.startsWith(prefix))
            return;
        const addr = req.socket.remoteAddress ?? "";
        if (!LOOPBACK_ADDRS.has(addr)) {
            reply.code(404).send({
                error: { code: "NOT_FOUND", message: "Not found" }
            });
        }
    });
}
//# sourceMappingURL=loopbackGuard.js.map