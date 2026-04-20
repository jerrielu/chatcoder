import { randomUUID } from "node:crypto";
import { MAX_QUEUE_DEPTH } from "@chatcoder/shared";
import type { Db } from "./index.js";

export interface QueuedMessage {
  id: string;
  sessionId: string;
  direction: "to_daemon" | "to_user";
  content: string;
  createdAt: number;
}

function rowToMessage(row: {
  id: string;
  session_id: string;
  direction: "to_daemon" | "to_user";
  content: string;
  created_at: number | string | bigint;
}): QueuedMessage {
  const raw = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    direction: row.direction,
    content: row.content,
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
   * Enqueue a message; enforces per-(session,direction) cap of MAX_QUEUE_DEPTH
   * by dropping the oldest.
   */
  async enqueue(args: {
    sessionId: string;
    direction: "to_daemon" | "to_user";
    content: string;
  }): Promise<EnqueueResult> {
    const ts = this.nextStamp();
    const id = randomUUID();
    return this.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("messages")
        .values({
          id,
          session_id: args.sessionId,
          direction: args.direction,
          content: args.content,
          created_at: ts
        })
        .execute();

      // Fetch all ids for this queue ordered by newest first.
      const all = await tx
        .selectFrom("messages")
        .select(["id", "created_at"])
        .where("session_id", "=", args.sessionId)
        .where("direction", "=", args.direction)
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

  /** Pop oldest message of a given direction, delivering (deleting) it. */
  async dequeueOldest(
    sessionId: string,
    direction: "to_daemon" | "to_user"
  ): Promise<QueuedMessage | null> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom("messages")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("direction", "=", direction)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .limit(1)
        .executeTakeFirst();
      if (!row) return null;
      await tx.deleteFrom("messages").where("id", "=", row.id).execute();
      return rowToMessage(row);
    });
  }

  /** Pop ALL pending messages of a given direction (used by daemon poll). */
  async drain(sessionId: string, direction: "to_daemon" | "to_user"): Promise<QueuedMessage[]> {
    return this.db.transaction().execute(async (tx) => {
      const rows = await tx
        .selectFrom("messages")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("direction", "=", direction)
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

  async count(sessionId: string, direction: "to_daemon" | "to_user"): Promise<number> {
    const row = await this.db
      .selectFrom("messages")
      .select(({ fn }) => fn.countAll().as("c"))
      .where("session_id", "=", sessionId)
      .where("direction", "=", direction)
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** Remove all messages for a session (used when revoking). */
  async purgeSession(sessionId: string): Promise<void> {
    await this.db.deleteFrom("messages").where("session_id", "=", sessionId).execute();
  }
}
