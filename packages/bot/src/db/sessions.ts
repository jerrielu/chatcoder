import { randomUUID } from "node:crypto";
import { CODE_RATE_LIMIT_MS } from "@chatcoder/shared";
import type { Db } from "./index.js";

export interface Session {
  id: string;
  chatId: number;
  apiKeyId: string;
  profileId: string;
  status: "active" | "revoked";
  createdAt: number;
  revokedAt: number | null;
  lastCodeAt: number;
  latestMessage: string | null;
  workDir: string | null;
}

function rowToSession(row: {
  id: string;
  chat_id: number | string | bigint;
  api_key_id: string;
  profile_id: string;
  status: "active" | "revoked";
  created_at: number | string | bigint;
  revoked_at: number | string | bigint | null;
  last_code_at: number | string | bigint;
  latest_message: string | null;
  work_dir: string | null;
}): Session {
  const n = (v: number | string | bigint | null): number | null =>
    v == null ? null : typeof v === "number" ? v : Number(v);
  return {
    id: row.id,
    chatId: n(row.chat_id) as number,
    apiKeyId: row.api_key_id,
    profileId: row.profile_id,
    status: row.status,
    createdAt: n(row.created_at) as number,
    revokedAt: n(row.revoked_at),
    lastCodeAt: n(row.last_code_at) as number,
    latestMessage: row.latest_message,
    workDir: row.work_dir ?? null
  };
}

export class SessionsRepo {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  /**
   * Create a session for (chat_id, api_key_id, profile_id).
   * All existing sessions for the chat_id are deleted first — a chat
   * holds at most one session at a time, and starting a new session
   * clears the slate (previous messages are cascade-deleted).
   */
  async create(args: {
    chatId: number;
    apiKeyId: string;
    profileId: string;
    workDir?: string;
  }): Promise<Session> {
    return this.db.transaction().execute(async (tx) => {
      // Clear all existing sessions for this chat — a fresh start.
      await tx
        .deleteFrom("sessions")
        .where("chat_id", "=", args.chatId)
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

  async getById(id: string): Promise<Session | null> {
    const row = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  /** Active session for a chat, or null. */
  async getActiveByChatId(chatId: number): Promise<Session | null> {
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
  async getLatestActiveByChatId(chatId: number): Promise<Session | null> {
    return this.getActiveByChatId(chatId);
  }

  async listActiveByApiKey(apiKeyId: string): Promise<Session[]> {
    const rows = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("api_key_id", "=", apiKeyId)
      .where("status", "=", "active")
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(rowToSession);
  }

  async listActiveByChatId(chatId: number): Promise<Session[]> {
    const rows = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("chat_id", "=", chatId)
      .where("status", "=", "active")
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(rowToSession);
  }

  async revoke(id: string): Promise<boolean> {
    const res = await this.db
      .updateTable("sessions")
      .set({ status: "revoked", revoked_at: this.now() })
      .where("id", "=", id)
      .where("status", "=", "active")
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async delete(id: string): Promise<boolean> {
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
  async tryConsumeRate(sessionId: string): Promise<boolean> {
    const ts = this.now();
    const res = await this.db
      .updateTable("sessions")
      .set({ last_code_at: ts })
      .where("id", "=", sessionId)
      .where("last_code_at", "<", ts - CODE_RATE_LIMIT_MS + 1)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) === 1;
  }

  async setLatestMessage(sessionId: string, content: string | null): Promise<boolean> {
    const res = await this.db
      .updateTable("sessions")
      .set({ latest_message: content })
      .where("id", "=", sessionId)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) === 1;
  }

  async setProfile(sessionId: string, profileId: string): Promise<boolean> {
    const res = await this.db
      .updateTable("sessions")
      .set({ profile_id: profileId })
      .where("id", "=", sessionId)
      .where("status", "=", "active")
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async setWorkDir(sessionId: string, workDir: string | null): Promise<void> {
    await this.db
      .updateTable("sessions")
      .set({ work_dir: workDir })
      .where("id", "=", sessionId)
      .execute();
  }
}
