const toNum = (v) => v == null ? null : typeof v === "number" ? v : Number(v);
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
function rowToJoined(row) {
    return {
        session: {
            id: row.s_id,
            chatId: toNum(row.s_chat_id),
            apiKeyId: row.s_api_key_id,
            profileId: row.s_profile_id,
            status: row.s_status,
            createdAt: toNum(row.s_created_at),
            revokedAt: toNum(row.s_revoked_at),
            lastCodeAt: toNum(row.s_last_code_at),
            latestMessage: row.s_latest_message,
            workDir: row.s_work_dir ?? null
        },
        profile: {
            id: row.p_id,
            apiKeyId: row.p_api_key_id,
            name: row.p_name,
            tool: row.p_tool,
            metadata: row.p_metadata,
            createdAt: toNum(row.p_created_at)
        },
        apiKey: {
            id: row.a_id,
            apiKeyHash: row.a_api_key_hash,
            apiKeyPrefix: row.a_api_key_prefix,
            status: row.a_status,
            createdAt: toNum(row.a_created_at),
            revokedAt: toNum(row.a_revoked_at),
            lastHeartbeat: toNum(row.a_last_heartbeat),
            workDirs: parseWorkDirs(row.a_work_dirs)
        }
    };
}
function rowToMessage(row) {
    const raw = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
    const resume = (() => {
        const v = row.resume_last_session;
        if (typeof v === "boolean")
            return v;
        return Number(v) !== 0;
    })();
    return {
        id: row.id,
        sessionId: row.session_id,
        content: row.content,
        kind: row.kind ?? "instruction",
        resumeLastSession: resume,
        ...(row.codex_reasoning_effort
            ? { codexReasoningEffort: row.codex_reasoning_effort }
            : {}),
        processingStartedAt: toNum(row.processing_started_at),
        createdAt: Math.floor(raw / 1024)
    };
}
/**
 * Admin queries used by the /v1/admin routes. Write paths reuse
 * SessionsRepo / MessagesRepo / ApiKeysRepo / ProfilesRepo.
 */
export class AdminRepo {
    db;
    now;
    constructor(db, now = Date.now) {
        this.db = db;
        this.now = now;
    }
    baseJoin() {
        return this.db
            .selectFrom("sessions as s")
            .innerJoin("profiles as p", "p.id", "s.profile_id")
            .innerJoin("api_keys as a", "a.id", "s.api_key_id")
            .select([
            "s.id as s_id",
            "s.chat_id as s_chat_id",
            "s.api_key_id as s_api_key_id",
            "s.profile_id as s_profile_id",
            "s.status as s_status",
            "s.created_at as s_created_at",
            "s.revoked_at as s_revoked_at",
            "s.last_code_at as s_last_code_at",
            "s.latest_message as s_latest_message",
            "s.work_dir as s_work_dir",
            "p.id as p_id",
            "p.api_key_id as p_api_key_id",
            "p.name as p_name",
            "p.tool as p_tool",
            "p.metadata as p_metadata",
            "p.created_at as p_created_at",
            "a.id as a_id",
            "a.api_key_hash as a_api_key_hash",
            "a.api_key_prefix as a_api_key_prefix",
            "a.status as a_status",
            "a.created_at as a_created_at",
            "a.revoked_at as a_revoked_at",
            "a.last_heartbeat as a_last_heartbeat",
            "a.work_dirs as a_work_dirs"
        ]);
    }
    async listSessions(args = {}) {
        let q = this.baseJoin();
        if (args.status)
            q = q.where("s.status", "=", args.status);
        if (args.chatId !== undefined)
            q = q.where("s.chat_id", "=", args.chatId);
        if (args.apiKeyId !== undefined)
            q = q.where("s.api_key_id", "=", args.apiKeyId);
        q = q.orderBy("s.created_at", "desc");
        if (args.limit !== undefined)
            q = q.limit(args.limit);
        if (args.offset !== undefined)
            q = q.offset(args.offset);
        const rows = await q.execute();
        return rows.map((r) => rowToJoined(r));
    }
    async countSessions(args = {}) {
        let q = this.db.selectFrom("sessions").select(({ fn }) => fn.count("id").as("cnt"));
        if (args.status)
            q = q.where("status", "=", args.status);
        if (args.chatId !== undefined)
            q = q.where("chat_id", "=", args.chatId);
        if (args.apiKeyId !== undefined)
            q = q.where("api_key_id", "=", args.apiKeyId);
        const res = await q.executeTakeFirst();
        return Number(res?.cnt ?? 0);
    }
    async getSessionById(id) {
        const row = await this.baseJoin().where("s.id", "=", id).executeTakeFirst();
        return row ? rowToJoined(row) : null;
    }
    async deleteSession(id) {
        const res = await this.db.deleteFrom("sessions").where("id", "=", id).executeTakeFirst();
        return Number(res.numDeletedRows) > 0;
    }
    async listMessages(sessionId) {
        const rows = await this.db
            .selectFrom("messages")
            .selectAll()
            .where("session_id", "=", sessionId)
            .orderBy("created_at", "asc")
            .orderBy("id", "asc")
            .execute();
        return rows.map(rowToMessage);
    }
    async getMessageById(id) {
        const row = await this.db
            .selectFrom("messages")
            .selectAll()
            .where("id", "=", id)
            .executeTakeFirst();
        return row ? rowToMessage(row) : null;
    }
    async updateMessageContent(id, content) {
        const res = await this.db
            .updateTable("messages")
            .set({ content })
            .where("id", "=", id)
            .executeTakeFirst();
        return Number(res.numUpdatedRows) > 0;
    }
    async deleteMessage(id) {
        const res = await this.db.deleteFrom("messages").where("id", "=", id).executeTakeFirst();
        return Number(res.numDeletedRows) > 0;
    }
}
//# sourceMappingURL=admin.js.map