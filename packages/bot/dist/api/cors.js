import cors from "@fastify/cors";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/**
 * CORS for the admin surface only. A request origin is allowed iff its
 * hostname is loopback — any port. This pairs with installLoopbackGuard,
 * which enforces that the peer IP itself is loopback; together they mean
 * only a browser running on the same host can hit /v1/admin/*.
 *
 * Registered globally on the app; daemon routes don't care about CORS
 * because daemon traffic is server-to-server and has no browser origin.
 */
export async function installAdminCors(app) {
    await app.register(cors, {
        origin: (origin, cb) => {
            // Non-browser requests (no Origin header) always pass.
            if (!origin) {
                cb(null, true);
                return;
            }
            try {
                const url = new URL(origin);
                if (LOOPBACK_HOSTNAMES.has(url.hostname)) {
                    cb(null, true);
                    return;
                }
            }
            catch {
                /* fall through to reject */
            }
            cb(null, false);
        },
        methods: ["GET", "POST", "PATCH", "DELETE"],
        credentials: false
    });
}
//# sourceMappingURL=cors.js.map