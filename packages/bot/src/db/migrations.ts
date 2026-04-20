import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "./schema.js";

export type Dialect = "sqlite" | "postgres";

/** Each migration is idempotent and advances `schema_version.version`. */
export async function runMigrations(db: Kysely<Database>, dialect: Dialect): Promise<void> {
  await ensureSchemaVersionTable(db, dialect);
  const current = await currentVersion(db);

  const steps: Array<{ v: number; up: () => Promise<void> }> = [
    { v: 1, up: () => applyInitialSchema(db, dialect) },
    { v: 2, up: () => migrateToChatId(db, dialect) }
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

async function ensureSchemaVersionTable(db: Kysely<Database>, _dialect: Dialect): Promise<void> {
  await db.schema
    .createTable("schema_version")
    .ifNotExists()
    .addColumn("version", "integer", (c) => c.primaryKey())
    .addColumn("applied_at", "bigint", (c) => c.notNull())
    .execute();
}

async function currentVersion(db: Kysely<Database>): Promise<number> {
  const row = await db
    .selectFrom("schema_version")
    .select(({ fn }) => fn.max<number>("version").as("v"))
    .executeTakeFirst();
  return Number(row?.v ?? 0);
}

async function applyInitialSchema(db: Kysely<Database>, dialect: Dialect): Promise<void> {
  // Postgres uses BIGINT; SQLite uses INTEGER — kysely's "bigint"/"integer" maps correctly.
  await db.schema
    .createTable("sessions")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("telegram_user", "bigint", (c) => c.notNull())
    .addColumn("api_key_hash", "text", (c) => c.notNull().unique())
    .addColumn("api_key_prefix", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("revoked_at", "bigint")
    .addColumn("last_heartbeat", "bigint")
    .addColumn("last_code_at", "bigint", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex("idx_sessions_tg_user_status")
    .ifNotExists()
    .on("sessions")
    .columns(["telegram_user", "status"])
    .execute();

  await db.schema
    .createTable("messages")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("session_id", "text", (c) =>
      c.notNull().references("sessions.id").onDelete("cascade")
    )
    .addColumn("direction", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("idx_messages_session_dir_created")
    .ifNotExists()
    .on("messages")
    .columns(["session_id", "direction", "created_at"])
    .execute();

  if (dialect === "postgres") {
    // harmless guard on postgres-only types; no-op for sqlite
    await sql`SELECT 1`.execute(db);
  }
}

async function migrateToChatId(db: Kysely<Database>, _dialect: Dialect): Promise<void> {
  // 1. Rename column
  await db.schema
    .alterTable("sessions")
    .renameColumn("telegram_user" as "chat_id", "chat_id")
    .execute();

  // 2. Index replacement
  await db.schema.dropIndex("idx_sessions_tg_user_status").ifExists().execute();

  await db.schema
    .createIndex("idx_sessions_chat_id_status")
    .ifNotExists()
    .on("sessions")
    .columns(["chat_id", "status"])
    .execute();
}
