import { randomUUID } from "node:crypto";
import { MAX_QUEUE_DEPTH } from "@chatcoder/shared";
import type { CodexReasoningEffort, MessageKind } from "@chatcoder/shared";
import type { Db } from "./index.js";

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  resumeLastSession: boolean;
  codexReasoningEffort?: CodexReasoningEffort;
  kind: MessageKind;
  processingStartedAt: number | null;
  createdAt: number;
}

function toBool(v: number | string | bigint | boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "bigint") return v !== 0n;
  return v !== "0" && v.toLowerCase() !== "false";
}

function rowToMessage(row: {
  id: string;
  session_id: string;
  content: string;
  resume_last_session: number | string | bigint | boolean;
  codex_reasoning_effort: CodexReasoningEffort | null;
  kind: string;
  processing_started_at: number | string | bigint | null;
  created_at: number | string | bigint;
}): QueuedMessage {
  const raw = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
  const processingStartedAt =
    row.processing_started_at == null
      ? null
      : typeof row.processing_started_at === "number"
        ? row.processing_started_at
        : Number(row.processing_started_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    kind: (row.kind as MessageKind) ?? "instruction",
    resumeLastSession: toBool(row.resume_last_session),
    ...(row.codex_reasoning_effort
      ? { codexReasoningEffort: row.codex_reasoning_effort }
      : {}),
    processingStartedAt,
    // External callers see the millisecond timestamp; the sub-ms seq bits are
    // stripped so comparisons with Date.now()-based clocks stay sane.
    createdAt: Math.floor(raw / 1024)
  };
}

export interface EnqueueResult {
  message: QueuedMessage;
  droppedOldestId: string | null;
}

export class MessagesRepo {
  /**
   * Monotonic counter mixed into created_at at sub-millisecond resolution so
   * two enqueues that land in the same `now()` tick retain their call order.
   * We shift created_at by 10 bits and OR in a bounded sequence — the SQL
   * column stays a simple BIGINT.
   */
  private seq = 0;

  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  private nextStamp(): number {
    const base = this.now() * 1024;
    const s = this.seq++ & 0x3ff;
    return base + s;
  }

  /**
   * Enqueue an instruction for the daemon; enforces per-session cap of
   * MAX_QUEUE_DEPTH by dropping the oldest.
   */
  async enqueue(args: {
    sessionId: string;
    content: string;
    kind?: MessageKind;
    resumeLastSession?: boolean;
    codexReasoningEffort?: CodexReasoningEffort;
  }): Promise<EnqueueResult> {
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
          codex_reasoning_effort: args.codexReasoningEffort ?? null,
          kind: args.kind ?? "instruction",
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

      let droppedOldestId: string | null = null;
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
  async drain(sessionId: string): Promise<QueuedMessage[]> {
    return this.db.transaction().execute(async (tx) => {
      const rows = await tx
        .selectFrom("messages")
        .selectAll()
        .where("session_id", "=", sessionId)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .execute();
      if (rows.length === 0) return [];
      await tx
        .deleteFrom("messages")
        .where(
          "id",
          "in",
          rows.map((r) => r.id)
        )
        .execute();
      return rows.map(rowToMessage);
    });
  }

  /**
   * Claim the next queued instruction for a session. If another instruction is
   * already in progress, no new work is claimed for that session.
   */
  async claimNext(sessionId: string): Promise<QueuedMessage | null> {
    return this.db.transaction().execute(async (tx) => {
      const inProgress = await tx
        .selectFrom("messages")
        .select("id")
        .where("session_id", "=", sessionId)
        .where("processing_started_at", "is not", null)
        .executeTakeFirst();
      if (inProgress) return null;

      const row = await tx
        .selectFrom("messages")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("processing_started_at", "is", null)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .executeTakeFirst();
      if (!row) return null;

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
   * Claim the next queued stop message for a session, even if another
   * instruction is currently in progress. Returns null if no stop message
   * is waiting.
   */
  async claimStop(sessionId: string): Promise<QueuedMessage | null> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom("messages")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("processing_started_at", "is", null)
        .where("kind", "=", "stop")
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .executeTakeFirst();
      if (!row) return null;

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
   * older than it is cleared (but NOT any currently in-progress instruction,
   * so its tracking persists in the DB and 📡 Status can show it). Newer
   * queued instructions remain pending and will run after it.
   */
  async claimLatestNewCodeAndClearBefore(sessionId: string): Promise<QueuedMessage | null> {
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
      if (!row) return null;

      await tx
        .deleteFrom("messages")
        .where("session_id", "=", sessionId)
        .where("id", "!=", row.id)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("created_at", "<", row.created_at),
              eb("processing_started_at", "is", null)
            ]),
            eb.and([
              eb("created_at", "=", row.created_at),
              eb("id", "<", row.id),
              eb("processing_started_at", "is", null)
            ])
          ])
        )
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

  async getProcessing(sessionId: string): Promise<QueuedMessage | null> {
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

  async completeProcessing(sessionId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("messages")
      .select("id")
      .where("session_id", "=", sessionId)
      .where("processing_started_at", "is not", null)
      .orderBy("processing_started_at", "asc")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (!row) return false;
    const res = await this.db.deleteFrom("messages").where("id", "=", row.id).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }

  async count(sessionId: string): Promise<number> {
    const row = await this.db
      .selectFrom("messages")
      .select(({ fn }) => fn.countAll().as("c"))
      .where("session_id", "=", sessionId)
      .where("processing_started_at", "is", null)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** Remove all messages for a session (used when revoking). */
  async purgeSession(sessionId: string): Promise<void> {
    await this.db.deleteFrom("messages").where("session_id", "=", sessionId).execute();
  }
}
