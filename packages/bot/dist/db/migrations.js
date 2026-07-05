import { sql } from "kysely";
/**
 * Fresh install: create all tables at version 1. There is no migration from
 * the old single-session schema — the user deletes the DB and starts over.
 */
export async function runMigrations(db, dialect) {
    await ensureSchemaVersionTable(db, dialect);
    const current = await currentVersion(db);
    const steps = [
        { v: 1, up: () => applyInitialSchema(db, dialect) },
        { v: 2, up: () => addResumeLastSessionToMessages(db) },
        { v: 3, up: () => addLatestMessageToSessions(db) },
        { v: 4, up: () => addProcessingStartedAtToMessages(db) },
        { v: 5, up: () => addCodexReasoningEffortToMessages(db) },
        { v: 6, up: () => addWorkDirs(db) },
        { v: 7, up: () => addMessageKind(db) }
    ];
    for (const step of steps) {
        if (step.v > current) {
            await step.up();
            await db
                .insertInto("schema_version")
                .values({ version: step.v, applied_at: Date.now() })
                .execute();
        }
    }
}
async function ensureSchemaVersionTable(db, _dialect) {
    await db.schema
        .createTable("schema_version")
        .ifNotExists()
        .addColumn("version", "integer", (c) => c.primaryKey())
        .addColumn("applied_at", "bigint", (c) => c.notNull())
        .execute();
}
async function currentVersion(db) {
    const row = await db
        .selectFrom("schema_version")
        .select(({ fn }) => fn.max("version").as("v"))
        .executeTakeFirst();
    return Number(row?.v ?? 0);
}
async function applyInitialSchema(db, dialect) {
    await db.schema
        .createTable("api_keys")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("api_key_hash", "text", (c) => c.notNull().unique())
        .addColumn("api_key_prefix", "text", (c) => c.notNull())
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("revoked_at", "bigint")
        .addColumn("last_heartbeat", "bigint")
        .execute();
    await db.schema
        .createTable("profiles")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("api_key_id", "text", (c) => c.notNull().references("api_keys.id").onDelete("cascade"))
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("tool", "text", (c) => c.notNull())
        .addColumn("metadata", "text")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
    await db.schema
        .createIndex("idx_profiles_api_key_name")
        .ifNotExists()
        .unique()
        .on("profiles")
        .columns(["api_key_id", "name"])
        .execute();
    await db.schema
        .createTable("sessions")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("chat_id", "bigint", (c) => c.notNull())
        .addColumn("api_key_id", "text", (c) => c.notNull().references("api_keys.id").onDelete("cascade"))
        .addColumn("profile_id", "text", (c) => c.notNull().references("profiles.id").onDelete("cascade"))
        .addColumn("status", "text", (c) => c.notNull())
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .addColumn("revoked_at", "bigint")
        .addColumn("last_code_at", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("latest_message", "text")
        .execute();
    await db.schema
        .createIndex("idx_sessions_chat_status")
        .ifNotExists()
        .on("sessions")
        .columns(["chat_id", "status"])
        .execute();
    await db.schema
        .createIndex("idx_sessions_api_key_status")
        .ifNotExists()
        .on("sessions")
        .columns(["api_key_id", "status"])
        .execute();
    await db.schema
        .createTable("messages")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("session_id", "text", (c) => c.notNull().references("sessions.id").onDelete("cascade"))
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("resume_last_session", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("codex_reasoning_effort", "text")
        .addColumn("processing_started_at", "bigint")
        .addColumn("created_at", "bigint", (c) => c.notNull())
        .execute();
    await db.schema
        .createIndex("idx_messages_session_created")
        .ifNotExists()
        .on("messages")
        .columns(["session_id", "created_at"])
        .execute();
    if (dialect === "postgres") {
        await sql `SELECT 1`.execute(db);
    }
}
async function addResumeLastSessionToMessages(db) {
    try {
        await db.schema
            .alterTable("messages")
            .addColumn("resume_last_session", "integer", (c) => c.notNull().defaultTo(1))
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
}
async function addLatestMessageToSessions(db) {
    try {
        await db.schema
            .alterTable("sessions")
            .addColumn("latest_message", "text")
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
}
async function addProcessingStartedAtToMessages(db) {
    try {
        await db.schema
            .alterTable("messages")
            .addColumn("processing_started_at", "bigint")
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
}
async function addCodexReasoningEffortToMessages(db) {
    try {
        await db.schema
            .alterTable("messages")
            .addColumn("codex_reasoning_effort", "text")
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
}
async function addWorkDirs(db) {
    try {
        await db.schema
            .alterTable("api_keys")
            .addColumn("work_dirs", "text")
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
    try {
        await db.schema
            .alterTable("sessions")
            .addColumn("work_dir", "text")
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
}
async function addMessageKind(db) {
    try {
        await db.schema
            .alterTable("messages")
            .addColumn("kind", "text", (c) => c.notNull().defaultTo("instruction"))
            .execute();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
        if (msg.includes("duplicate column") || msg.includes("already exists"))
            return;
        throw e;
    }
}
//# sourceMappingURL=migrations.js.map