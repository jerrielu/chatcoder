import type { Db } from "./index.js";
import type { Session } from "./sessions.js";
import type { QueuedMessage } from "./messages.js";

type SessionRow = {
  id: string;
  chat_id: number | string | bigint;
  api_key_hash: string;
  api_key_prefix: string;
  status: "active" | "revoked";
  created_at: number | string | bigint;
  revoked_at: number | string | bigint | null;
  last_heartbeat: number | string | bigint | null;
  last_code_at: number | string | bigint;
};

type MessageRow = {
  id: string;
  session_id: string;
  direction: "to_daemon" | "to_user";
  content: string;
  created_at: number | string | bigint;
};

const toNum = (v: number | string | bigint | null): number | null =>
  v == null ? null : typeof v === "number" ? v : Number(v);

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    chatId: toNum(row.chat_id) as number,
    apiKeyHash: row.api_key_hash,
    apiKeyPrefix: row.api_key_prefix,
    status: row.status,
    createdAt: toNum(row.created_at) as number,
    revokedAt: toNum(row.revoked_at),
    lastHeartbeat: toNum(row.last_heartbeat),
    lastCodeAt: toNum(row.last_code_at) as number
  };
}

function rowToMessage(row: MessageRow): QueuedMessage {
  const raw = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
  return {
    id: row.id,
    sessionId: row.session_id,
    direction: row.direction,
    content: row.content,
    createdAt: Math.floor(raw / 1024)
  };
}

export interface ListSessionsArgs {
  status?: "active" | "revoked";
  chatId?: number;
  limit?: number;
  offset?: number;
}

/**
 * Admin queries used by the /v1/admin routes. Lives in the bot workspace
 * because the dashboard no longer opens the DB directly; it calls the bot
 * over HTTP. Write paths reuse SessionsRepo / MessagesRepo where those
 * already exist in the bot.
 */
export class AdminRepo {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  async listSessions(args: ListSessionsArgs = {}): Promise<Session[]> {
    let q = this.db.selectFrom("sessions").selectAll();
    if (args.status) q = q.where("status", "=", args.status);
    if (args.chatId !== undefined) q = q.where("chat_id", "=", args.chatId);
    q = q.orderBy("created_at", "desc");
    if (args.limit !== undefined) q = q.limit(args.limit);
    if (args.offset !== undefined) q = q.offset(args.offset);
    const rows = await q.execute();
    return rows.map(rowToSession);
  }

  async countSessions(args: ListSessionsArgs = {}): Promise<number> {
    let q = this.db.selectFrom("sessions").select(({ fn }) => fn.count("id").as("cnt"));
    if (args.status) q = q.where("status", "=", args.status);
    if (args.chatId !== undefined) q = q.where("chat_id", "=", args.chatId);
    const res = await q.executeTakeFirst();
    return Number(res?.cnt ?? 0);
  }

  async getSessionById(id: string): Promise<Session | null> {
    const row = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async deleteSession(id: string): Promise<boolean> {
    const res = await this.db.deleteFrom("sessions").where("id", "=", id).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }

  async updateSession(id: string, args: { chatId: number }): Promise<boolean> {
    const res = await this.db
      .updateTable("sessions")
      .set({ chat_id: args.chatId })
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async revokeSession(id: string): Promise<boolean> {
    const res = await this.db
      .updateTable("sessions")
      .set({ status: "revoked", revoked_at: this.now() })
      .where("id", "=", id)
      .where("status", "=", "active")
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async listMessages(
    sessionId: string,
    direction?: "to_daemon" | "to_user"
  ): Promise<QueuedMessage[]> {
    let q = this.db.selectFrom("messages").selectAll().where("session_id", "=", sessionId);
    if (direction) q = q.where("direction", "=", direction);
    q = q.orderBy("created_at", "asc").orderBy("id", "asc");
    const rows = await q.execute();
    return rows.map(rowToMessage);
  }

  async getMessageById(id: string): Promise<QueuedMessage | null> {
    const row = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? rowToMessage(row) : null;
  }

  async updateMessageContent(id: string, content: string): Promise<boolean> {
    const res = await this.db
      .updateTable("messages")
      .set({ content })
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async deleteMessage(id: string): Promise<boolean> {
    const res = await this.db.deleteFrom("messages").where("id", "=", id).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }
}
