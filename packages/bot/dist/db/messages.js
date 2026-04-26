import { randomUUID } from "node:crypto";
import { MAX_QUEUE_DEPTH } from "@chatcoder/shared";
function toBool(v) {
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    if (typeof v === "bigint")
        return v !== 0n;
    return v !== "0" && v.toLowerCase() !== "false";
}
function rowToMessage(row) {
    const raw = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
    const processingStartedAt = row.processing_started_at == null
        ? null
        : typeof row.processing_started_at === "number"
            ? row.processing_started_at
            : Number(row.processing_started_at);
    return {
        id: row.id,
        sessionId: row.session_id,
        content: row.content,
        resumeLastSession: toBool(row.resume_last_session),
        processingStartedAt,
        // External callers see the millisecond timestamp; the sub-ms seq bits are
        // stripped so comparisons with Date.now()-based clocks stay sane.
        createdAt: Math.floor(raw / 1024)
    };
}
export class MessagesRepo {
    db;
    now;
    /**
     * Monotonic counter mixed into created_at at sub-millisecond resolution so
     * two enqueues that land in the same `now()` tick retain their call order.
     * We shift created_at by 10 bits and OR in a bounded sequence — the SQL
     * column stays a simple BIGINT.
     */
    seq = 0;
    constructor(db, now = Date.now) {
        this.db = db;
        this.now = now;
    }
    nextStamp() {
        const base = this.now() * 1024;
        const s = this.seq++ & 0x3ff;
        return base + s;
    }
    /**
     * Enqueue an instruction for the daemon; enforces per-session cap of
     * MAX_QUEUE_DEPTH by dropping the oldest.
     */
    async enqueue(args) {
        const ts = this.nextStamp();
        const id = randomUUID();
        const resumeLastSession = args.resumeLastSession ?? true;
        return this.db.transaction().execute(async (tx) => {
            await tx
                .insertInto("messages")
                .values({
                id,
                session_id: args.sessionId,
                content: args.content,
                resume_last_session: resumeLastSession ? 1 : 0,
                processing_started_at: null,
                created_at: ts
            })
                .execute();
            const all = await tx
                .selectFrom("messages")
                .select(["id", "created_at"])
                .where("session_id", "=", args.sessionId)
                .where("processing_started_at", "is", null)
                .orderBy("created_at", "desc")
                .orderBy("id", "desc")
                .execute();
            let droppedOldestId = null;
            if (all.length > MAX_QUEUE_DEPTH) {
                const toDrop = all.slice(MAX_QUEUE_DEPTH).map((r) => r.id);
                droppedOldestId = toDrop[toDrop.length - 1] ?? null;
                await tx.deleteFrom("messages").where("id", "in", toDrop).execute();
            }
            const row = await tx
                .selectFrom("messages")
                .selectAll()
                .where("id", "=", id)
                .executeTakeFirstOrThrow();
            return { message: rowToMessage(row), droppedOldestId };
        });
    }
    /** Pop ALL pending instructions for a session (legacy tests/admin helpers). */
    async drain(sessionId) {
        return this.db.transaction().execute(async (tx) => {
            const rows = await tx
                .selectFrom("messages")
                .selectAll()
                .where("session_id", "=", sessionId)
                .orderBy("created_at", "asc")
                .orderBy("id", "asc")
                .execute();
            if (rows.length === 0)
                return [];
            await tx
                .deleteFrom("messages")
                .where("id", "in", rows.map((r) => r.id))
                .execute();
            return rows.map(rowToMessage);
        });
    }
    /**
     * Claim the next queued instruction for a session. If another instruction is
     * already in progress, no new work is claimed for that session.
     */
    async claimNext(sessionId) {
        return this.db.transaction().execute(async (tx) => {
            const inProgress = await tx
                .selectFrom("messages")
                .select("id")
                .where("session_id", "=", sessionId)
                .where("processing_started_at", "is not", null)
                .executeTakeFirst();
            if (inProgress)
                return null;
            const row = await tx
                .selectFrom("messages")
                .selectAll()
                .where("session_id", "=", sessionId)
                .where("processing_started_at", "is", null)
                .orderBy("created_at", "asc")
                .orderBy("id", "asc")
                .executeTakeFirst();
            if (!row)
                return null;
            const processingStartedAt = this.now();
            await tx
                .updateTable("messages")
                .set({ processing_started_at: processingStartedAt })
                .where("id", "=", row.id)
                .execute();
            return rowToMessage({ ...row, processing_started_at: processingStartedAt });
        });
    }
    /**
     * Claim the newest queued "New Code" instruction for a session. Everything
     * older than it is cleared, including any currently in-progress instruction.
     * Newer queued instructions remain pending and will run after it.
     */
    async claimLatestNewCodeAndClearBefore(sessionId) {
        return this.db.transaction().execute(async (tx) => {
            const row = await tx
                .selectFrom("messages")
                .selectAll()
                .where("session_id", "=", sessionId)
                .where("processing_started_at", "is", null)
                .where("resume_last_session", "=", 0)
                .orderBy("created_at", "desc")
                .orderBy("id", "desc")
                .executeTakeFirst();
            if (!row)
                return null;
            await tx
                .deleteFrom("messages")
                .where("session_id", "=", sessionId)
                .where("id", "!=", row.id)
                .where((eb) => eb.or([
                eb("processing_started_at", "is not", null),
                eb("created_at", "<", row.created_at),
                eb.and([
                    eb("created_at", "=", row.created_at),
                    eb("id", "<", row.id)
                ])
            ]))
                .execute();
            const processingStartedAt = this.now();
            await tx
                .updateTable("messages")
                .set({ processing_started_at: processingStartedAt })
                .where("id", "=", row.id)
                .execute();
            return rowToMessage({ ...row, processing_started_at: processingStartedAt });
        });
    }
    async getProcessing(sessionId) {
        const row = await this.db
            .selectFrom("messages")
            .selectAll()
            .where("session_id", "=", sessionId)
            .where("processing_started_at", "is not", null)
            .orderBy("processing_started_at", "asc")
            .orderBy("created_at", "asc")
            .executeTakeFirst();
        return row ? rowToMessage(row) : null;
    }
    async completeProcessing(sessionId) {
        const row = await this.db
            .selectFrom("messages")
            .select("id")
            .where("session_id", "=", sessionId)
            .where("processing_started_at", "is not", null)
            .orderBy("processing_started_at", "asc")
            .orderBy("created_at", "asc")
            .executeTakeFirst();
        if (!row)
            return false;
        const res = await this.db.deleteFrom("messages").where("id", "=", row.id).executeTakeFirst();
        return Number(res.numDeletedRows) > 0;
    }
    async count(sessionId) {
        const row = await this.db
            .selectFrom("messages")
            .select(({ fn }) => fn.countAll().as("c"))
            .where("session_id", "=", sessionId)
            .where("processing_started_at", "is", null)
            .executeTakeFirstOrThrow();
        return Number(row.c);
    }
    /** Remove all messages for a session (used when revoking). */
    async purgeSession(sessionId) {
        await this.db.deleteFrom("messages").where("session_id", "=", sessionId).execute();
    }
}
//# sourceMappingURL=messages.js.map