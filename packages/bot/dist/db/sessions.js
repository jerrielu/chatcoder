import { randomUUID } from "node:crypto";
import { CODE_RATE_LIMIT_MS } from "@chatcoder/shared";
function rowToSession(row) {
    const n = (v) => v == null ? null : typeof v === "number" ? v : Number(v);
    return {
        id: row.id,
        chatId: n(row.chat_id),
        apiKeyId: row.api_key_id,
        profileId: row.profile_id,
        status: row.status,
        createdAt: n(row.created_at),
        revokedAt: n(row.revoked_at),
        lastCodeAt: n(row.last_code_at),
        latestMessage: row.latest_message,
        workDir: row.work_dir ?? null
    };
}
export class SessionsRepo {
    db;
    now;
    constructor(db, now = Date.now) {
        this.db = db;
        this.now = now;
    }
    /**
     * Create a session for (chat_id, api_key_id, profile_id).
     * If an active session already exists for the same chat_id, it is revoked
     * first — a chat may hold at most one active session.
     * If an active session already exists for the same triple, return it
     * unchanged (no-op).
     */
    async create(args) {
        return this.db.transaction().execute(async (tx) => {
            // If the exact triple already exists, return it unchanged.
            const existing = await tx
                .selectFrom("sessions")
                .selectAll()
                .where("chat_id", "=", args.chatId)
                .where("api_key_id", "=", args.apiKeyId)
                .where("profile_id", "=", args.profileId)
                .where("status", "=", "active")
                .executeTakeFirst();
            if (existing)
                return rowToSession(existing);
            // Revoke any other active session for this (chat, apiKey) so profile
            // switching replaces the session rather than adding a new one.
            await tx
                .updateTable("sessions")
                .set({ status: "revoked", revoked_at: this.now() })
                .where("chat_id", "=", args.chatId)
                .where("api_key_id", "=", args.apiKeyId)
                .where("status", "=", "active")
                .execute();
            const id = randomUUID();
            const ts = this.now();
            await tx
                .insertInto("sessions")
                .values({
                id,
                chat_id: args.chatId,
                api_key_id: args.apiKeyId,
                profile_id: args.profileId,
                status: "active",
                created_at: ts,
                revoked_at: null,
                last_code_at: 0,
                latest_message: null,
                work_dir: args.workDir ?? null
            })
                .execute();
            const row = await tx
                .selectFrom("sessions")
                .selectAll()
                .where("id", "=", id)
                .executeTakeFirstOrThrow();
            return rowToSession(row);
        });
    }
    async getById(id) {
        const row = await this.db
            .selectFrom("sessions")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? rowToSession(row) : null;
    }
    /** Active session for a chat, or null. */
    async getActiveByChatId(chatId) {
        const row = await this.db
            .selectFrom("sessions")
            .selectAll()
            .where("chat_id", "=", chatId)
            .where("status", "=", "active")
            .orderBy("created_at", "desc")
            .executeTakeFirst();
        return row ? rowToSession(row) : null;
    }
    /** @deprecated Use getActiveByChatId — only one active session per chat. */
    async getLatestActiveByChatId(chatId) {
        return this.getActiveByChatId(chatId);
    }
    async listActiveByApiKey(apiKeyId) {
        const rows = await this.db
            .selectFrom("sessions")
            .selectAll()
            .where("api_key_id", "=", apiKeyId)
            .where("status", "=", "active")
            .orderBy("created_at", "asc")
            .execute();
        return rows.map(rowToSession);
    }
    async listActiveByChatId(chatId) {
        const rows = await this.db
            .selectFrom("sessions")
            .selectAll()
            .where("chat_id", "=", chatId)
            .where("status", "=", "active")
            .orderBy("created_at", "desc")
            .execute();
        return rows.map(rowToSession);
    }
    async revoke(id) {
        const res = await this.db
            .updateTable("sessions")
            .set({ status: "revoked", revoked_at: this.now() })
            .where("id", "=", id)
            .where("status", "=", "active")
            .executeTakeFirst();
        return Number(res.numUpdatedRows) > 0;
    }
    async delete(id) {
        const res = await this.db
            .deleteFrom("sessions")
            .where("id", "=", id)
            .executeTakeFirst();
        return Number(res.numDeletedRows) > 0;
    }
    /**
     * Atomic rate limit check. Returns true if accepted (row updated),
     * false if the caller is within the 1-second window. Rate-limit is
     * per-session so different profiles aren't throttled by each other.
     */
    async tryConsumeRate(sessionId) {
        const ts = this.now();
        const res = await this.db
            .updateTable("sessions")
            .set({ last_code_at: ts })
            .where("id", "=", sessionId)
            .where("last_code_at", "<", ts - CODE_RATE_LIMIT_MS + 1)
            .executeTakeFirst();
        return Number(res.numUpdatedRows ?? 0) === 1;
    }
    async setLatestMessage(sessionId, content) {
        const res = await this.db
            .updateTable("sessions")
            .set({ latest_message: content })
            .where("id", "=", sessionId)
            .executeTakeFirst();
        return Number(res.numUpdatedRows ?? 0) === 1;
    }
    async setProfile(sessionId, profileId) {
        const res = await this.db
            .updateTable("sessions")
            .set({ profile_id: profileId })
            .where("id", "=", sessionId)
            .where("status", "=", "active")
            .executeTakeFirst();
        return Number(res.numUpdatedRows) > 0;
    }
    async setWorkDir(sessionId, workDir) {
        await this.db
            .updateTable("sessions")
            .set({ work_dir: workDir })
            .where("id", "=", sessionId)
            .execute();
    }
}
//# sourceMappingURL=sessions.js.map