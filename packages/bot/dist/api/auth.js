import { ApiError } from "@chatcoder/shared";
import { hashApiKey } from "../db/crypto.js";
export function extractBearer(req) {
    const h = req.headers["authorization"];
    if (!h || typeof h !== "string")
        return null;
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    return m?.[1] ?? null;
}
/**
 * Installs an onRequest hook that authenticates daemon requests by api_key.
 * Sessions are resolved per-request inside the handlers because a single
 * daemon may have many sessions concurrently.
 */
export function installAuth(app, opts) {
    const skipPrefixes = opts.skipPrefixes ?? [];
    app.addHook("onRequest", async (req) => {
        if (!req.url.startsWith(opts.protectedPrefix))
            return;
        for (const skip of skipPrefixes) {
            if (req.url.startsWith(skip))
                return;
        }
        const raw = extractBearer(req);
        if (!raw)
            throw ApiError.unauthorized("Missing bearer token");
        const rec = await opts.apiKeysRepo.getByHash(hashApiKey(raw));
        if (!rec)
            throw ApiError.unauthorized();
        if (rec.status === "revoked")
            throw ApiError.sessionRevoked();
        req.apiKey = rec;
    });
}
//# sourceMappingURL=auth.js.map