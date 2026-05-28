import type { Db } from "./index.js";
import type { Session } from "./sessions.js";
import type { ApiKeyRecord } from "./apiKeys.js";
import type { ProfileRecord } from "./profiles.js";
import type { QueuedMessage } from "./messages.js";
import type { CodexReasoningEffort, ToolKind } from "@chatcoder/shared";

type NumLike = number | string | bigint;
const toNum = (v: NumLike | null): number | null =>
  v == null ? null : typeof v === "number" ? v : Number(v);

function parseWorkDirs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
}

/** Session joined with its profile + api_key — drives the admin UI. */
export interface SessionJoined {
  session: Session;
  profile: ProfileRecord;
  apiKey: ApiKeyRecord;
}

interface JoinedRow {
  s_id: string;
  s_chat_id: NumLike;
  s_api_key_id: string;
  s_profile_id: string;
  s_status: "active" | "revoked";
  s_created_at: NumLike;
  s_revoked_at: NumLike | null;
  s_last_code_at: NumLike;
  s_latest_message: string | null;
  s_work_dir: string | null;
  p_id: string;
  p_api_key_id: string;
  p_name: string;
  p_tool: ToolKind;
  p_metadata: string | null;
  p_created_at: NumLike;
  a_id: string;
  a_api_key_hash: string;
  a_api_key_prefix: string;
  a_status: "active" | "revoked";
  a_created_at: NumLike;
  a_revoked_at: NumLike | null;
  a_last_heartbeat: NumLike | null;
  a_work_dirs: string | null;
}

function rowToJoined(row: JoinedRow): SessionJoined {
  return {
    session: {
      id: row.s_id,
      chatId: toNum(row.s_chat_id) as number,
      apiKeyId: row.s_api_key_id,
      profileId: row.s_profile_id,
      status: row.s_status,
      createdAt: toNum(row.s_created_at) as number,
      revokedAt: toNum(row.s_revoked_at),
      lastCodeAt: toNum(row.s_last_code_at) as number,
      latestMessage: row.s_latest_message,
      workDir: row.s_work_dir ?? null
    },
    profile: {
      id: row.p_id,
      apiKeyId: row.p_api_key_id,
      name: row.p_name,
      tool: row.p_tool,
      metadata: row.p_metadata,
      createdAt: toNum(row.p_created_at) as number
    },
    apiKey: {
      id: row.a_id,
      apiKeyHash: row.a_api_key_hash,
      apiKeyPrefix: row.a_api_key_prefix,
      status: row.a_status,
      createdAt: toNum(row.a_created_at) as number,
      revokedAt: toNum(row.a_revoked_at),
      lastHeartbeat: toNum(row.a_last_heartbeat),
      workDirs: parseWorkDirs(row.a_work_dirs)
    }
  };
}

function rowToMessage(row: {
  id: string;
  session_id: string;
  content: string;
  resume_last_session: NumLike | boolean;
  codex_reasoning_effort: CodexReasoningEffort | null;
  processing_started_at: NumLike | null;
  created_at: NumLike;
}): QueuedMessage {
  const raw = typeof row.created_at === "number" ? row.created_at : Number(row.created_at);
  const resume = (() => {
    const v = row.resume_last_session;
    if (typeof v === "boolean") return v;
    return Number(v) !== 0;
  })();
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    resumeLastSession: resume,
    ...(row.codex_reasoning_effort
      ? { codexReasoningEffort: row.codex_reasoning_effort }
      : {}),
    processingStartedAt: toNum(row.processing_started_at),
    createdAt: Math.floor(raw / 1024)
  };
}

export interface ListSessionsArgs {
  status?: "active" | "revoked";
  chatId?: number;
  apiKeyId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Admin queries used by the /v1/admin routes. Write paths reuse
 * SessionsRepo / MessagesRepo / ApiKeysRepo / ProfilesRepo.
 */
export class AdminRepo {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  private baseJoin() {
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

  async listSessions(args: ListSessionsArgs = {}): Promise<SessionJoined[]> {
    let q = this.baseJoin();
    if (args.status) q = q.where("s.status", "=", args.status);
    if (args.chatId !== undefined) q = q.where("s.chat_id", "=", args.chatId);
    if (args.apiKeyId !== undefined) q = q.where("s.api_key_id", "=", args.apiKeyId);
    q = q.orderBy("s.created_at", "desc");
    if (args.limit !== undefined) q = q.limit(args.limit);
    if (args.offset !== undefined) q = q.offset(args.offset);
    const rows = await q.execute();
    return rows.map((r) => rowToJoined(r as unknown as JoinedRow));
  }

  async countSessions(args: ListSessionsArgs = {}): Promise<number> {
    let q = this.db.selectFrom("sessions").select(({ fn }) => fn.count("id").as("cnt"));
    if (args.status) q = q.where("status", "=", args.status);
    if (args.chatId !== undefined) q = q.where("chat_id", "=", args.chatId);
    if (args.apiKeyId !== undefined) q = q.where("api_key_id", "=", args.apiKeyId);
    const res = await q.executeTakeFirst();
    return Number(res?.cnt ?? 0);
  }

  async getSessionById(id: string): Promise<SessionJoined | null> {
    const row = await this.baseJoin().where("s.id", "=", id).executeTakeFirst();
    return row ? rowToJoined(row as unknown as JoinedRow) : null;
  }

  async deleteSession(id: string): Promise<boolean> {
    const res = await this.db.deleteFrom("sessions").where("id", "=", id).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }

  async listMessages(sessionId: string): Promise<QueuedMessage[]> {
    const rows = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
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
