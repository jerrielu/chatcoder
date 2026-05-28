import { randomUUID } from "node:crypto";
import { hashApiKey } from "./crypto.js";
function rowToRecord(row) {
    const n = (v) => v == null ? null : typeof v === "number" ? v : Number(v);
    return {
        id: row.id,
        apiKeyHash: row.api_key_hash,
        apiKeyPrefix: row.api_key_prefix,
        status: row.status,
        createdAt: n(row.created_at),
        revokedAt: n(row.revoked_at),
        lastHeartbeat: n(row.last_heartbeat),
        workDirs: parseWorkDirs(row.work_dirs)
    };
}
function parseWorkDirs(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((d) => typeof d === "string") : [];
    }
    catch {
        return [];
    }
}
export class ApiKeysRepo {
    db;
    now;
    constructor(db, now = Date.now) {
        this.db = db;
        this.now = now;
    }
    /**
     * Idempotent register by raw API key. Creates an active row on first call;
     * returns the existing record on subsequent calls. Revoked rows for the
     * same hash are rejected (reuse of a revoked key is disallowed).
     */
    async registerByRawKey(rawApiKey) {
        const hash = hashApiKey(rawApiKey);
        const existing = await this.getByHash(hash);
        if (existing) {
            if (existing.status === "revoked") {
                throw new Error("This API key has been revoked; generate a new one.");
            }
            return existing;
        }
        const id = randomUUID();
        await this.db
            .insertInto("api_keys")
            .values({
            id,
            api_key_hash: hash,
            api_key_prefix: rawApiKey.slice(0, 8),
            status: "active",
            created_at: this.now(),
            revoked_at: null,
            last_heartbeat: null
        })
            .execute();
        const row = await this.db
            .selectFrom("api_keys")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
        return rowToRecord(row);
    }
    async getByHash(hash) {
        const row = await this.db
            .selectFrom("api_keys")
            .selectAll()
            .where("api_key_hash", "=", hash)
            .executeTakeFirst();
        return row ? rowToRecord(row) : null;
    }
    async getByRawKey(rawApiKey) {
        return this.getByHash(hashApiKey(rawApiKey));
    }
    async getById(id) {
        const row = await this.db
            .selectFrom("api_keys")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? rowToRecord(row) : null;
    }
    async list(args = {}) {
        let q = this.db.selectFrom("api_keys").selectAll().orderBy("created_at", "desc");
        if (args.status)
            q = q.where("status", "=", args.status);
        if (args.limit !== undefined)
            q = q.limit(args.limit);
        if (args.offset !== undefined)
            q = q.offset(args.offset);
        const rows = await q.execute();
        return rows.map(rowToRecord);
    }
    async count(args = {}) {
        let q = this.db.selectFrom("api_keys").select(({ fn }) => fn.count("id").as("c"));
        if (args.status)
            q = q.where("status", "=", args.status);
        const res = await q.executeTakeFirst();
        return Number(res?.c ?? 0);
    }
    async updateHeartbeat(id) {
        await this.db
            .updateTable("api_keys")
            .set({ last_heartbeat: this.now() })
            .where("id", "=", id)
            .execute();
    }
    async revoke(id) {
        const res = await this.db
            .updateTable("api_keys")
            .set({ status: "revoked", revoked_at: this.now() })
            .where("id", "=", id)
            .where("status", "=", "active")
            .executeTakeFirst();
        return Number(res.numUpdatedRows) > 0;
    }
    async delete(id) {
        const res = await this.db
            .deleteFrom("api_keys")
            .where("id", "=", id)
            .executeTakeFirst();
        return Number(res.numDeletedRows) > 0;
    }
    async setWorkDirs(id, dirs) {
        await this.db
            .updateTable("api_keys")
            .set({ work_dirs: dirs.length > 0 ? JSON.stringify(dirs) : null })
            .where("id", "=", id)
            .execute();
    }
}
//# sourceMappingURL=apiKeys.js.map