import type { ColumnType, Generated } from "kysely";

export interface ApiKeysTable {
  id: string;
  api_key_hash: string;
  api_key_prefix: string;
  status: "active" | "revoked";
  created_at: number;
  revoked_at: number | null;
  last_heartbeat: number | null;
  work_dirs: string | null;
}

export interface ProfilesTable {
  id: string;
  api_key_id: string;
  name: string;
  tool: "CLAUDE_CODE" | "OPENAI" | "REASONIX" | "CUSTOM";
  metadata: string | null;
  created_at: number;
}

export interface SessionsTable {
  id: string;
  chat_id: number;
  api_key_id: string;
  profile_id: string;
  status: "active" | "revoked";
  created_at: number;
  revoked_at: number | null;
  last_code_at: number;
  latest_message: string | null;
  work_dir: string | null;
}

export interface MessagesTable {
  id: string;
  session_id: string;
  content: string;
  /** 1 = resume existing CLI session, 0 = start fresh. */
  resume_last_session: number;
  /** Optional Codex reasoning effort override for OPENAI profile messages. */
  codex_reasoning_effort: "low" | "medium" | "high" | "xhigh" | null;
  /** Non-null while a daemon has claimed this instruction and is processing it. */
  processing_started_at: number | null;
  created_at: number;
}

export interface SchemaVersionTable {
  version: ColumnType<number, number, number>;
  applied_at: Generated<number>;
}

export interface Database {
  api_keys: ApiKeysTable;
  profiles: ProfilesTable;
  sessions: SessionsTable;
  messages: MessagesTable;
  schema_version: SchemaVersionTable;
}
