import type { ColumnType, Generated } from "kysely";

export interface SessionsTable {
  id: string;
  chat_id: number;
  api_key_hash: string;
  api_key_prefix: string;
  status: "active" | "revoked";
  created_at: number;
  revoked_at: number | null;
  last_heartbeat: number | null;
  last_code_at: number;
}

export interface MessagesTable {
  id: string;
  session_id: string;
  direction: "to_daemon" | "to_user";
  content: string;
  created_at: number;
}

export interface SchemaVersionTable {
  version: ColumnType<number, number, number>;
  applied_at: Generated<number>;
}

export interface Database {
  sessions: SessionsTable;
  messages: MessagesTable;
  schema_version: SchemaVersionTable;
}
