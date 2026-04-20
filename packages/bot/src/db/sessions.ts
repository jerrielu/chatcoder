import { randomUUID, randomBytes, createHash } from "node:crypto";
import {
  API_KEY_PREFIX,
  API_KEY_RAND_BYTES,
  CODE_RATE_LIMIT_MS,
  MIN_API_KEY_LENGTH
} from "@chatcoder/shared";
import type { Db } from "./index.js";

export interface Session {
  id: string;
  chatId: number;
  apiKeyHash: string;
  apiKeyPrefix: string;
  status: "active" | "revoked";
  createdAt: number;
  revokedAt: number | null;
  lastHeartbeat: number | null;
  lastCodeAt: number;
}

export interface GeneratedKey {
  rawApiKey: string;
  hash: string;
  prefix: string;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const raw = API_KEY_PREFIX + randomBytes(API_KEY_RAND_BYTES).toString("base64url");
  return { rawApiKey: raw, hash: hashApiKey(raw), prefix: raw.slice(0, 8) };
}

export function validateUserSuppliedKey(raw: string): void {
  if (!raw || raw.length < MIN_API_KEY_LENGTH) {
    throw new Error(`API key must be at least ${MIN_API_KEY_LENGTH} characters.`);
  }
  if (/\s/.test(raw)) throw new Error("API key may not contain whitespace.");
}

function rowToSession(row: {
  id: string;
  chat_id: number | string | bigint;
  api_key_hash: string;
  api_key_prefix: string;
  status: "active" | "revoked";
  created_at: number | string | bigint;
  revoked_at: number | string | bigint | null;
  last_heartbeat: number | string | bigint | null;
  last_code_at: number | string | bigint;
}): Session {
  const n = (v: number | string | bigint | null): number | null =>
    v == null ? null : typeof v === "number" ? v : Number(v);
  return {
    id: row.id,
    chatId: n(row.chat_id) as number,
    apiKeyHash: row.api_key_hash,
    apiKeyPrefix: row.api_key_prefix,
    status: row.status,
    createdAt: n(row.created_at) as number,
    revokedAt: n(row.revoked_at),
    lastHeartbeat: n(row.last_heartbeat),
    lastCodeAt: n(row.last_code_at) as number
  };
}

export class SessionsRepo {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  /**
   * Create a new session for a telegram user, revoking any existing active one.
   * Accepts either a raw API key or generates one.
   */
  async rotate(args: {
    chatId: number;
    rawApiKey?: string;
  }): Promise<{ session: Session; rawApiKey: string }> {
    let raw: string;
    let hash: string;
    let prefix: string;
    if (args.rawApiKey) {
      validateUserSuppliedKey(args.rawApiKey);
      raw = args.rawApiKey;
      hash = hashApiKey(raw);
      prefix = raw.slice(0, 8);
    } else {
      const gen = generateApiKey();
      raw = gen.rawApiKey;
      hash = gen.hash;
      prefix = gen.prefix;
    }

    const ts = this.now();

    return this.db.transaction().execute(async (tx) => {
      // Revoke existing active sessions for this chat.
      await tx
        .updateTable("sessions")
        .set({ status: "revoked", revoked_at: ts })
        .where("chat_id", "=", args.chatId)
        .where("status", "=", "active")
        .execute();

      // Make sure this hash isn't colliding with any historical session.
      const existing = await tx
        .selectFrom("sessions")
        .select("id")
        .where("api_key_hash", "=", hash)
        .executeTakeFirst();
      if (existing) {
        throw new Error("API key already in use — choose a different key.");
      }

      const id = randomUUID();
      await tx
        .insertInto("sessions")
        .values({
          id,
          chat_id: args.chatId,
          api_key_hash: hash,
          api_key_prefix: prefix,
          status: "active",
          created_at: ts,
          revoked_at: null,
          last_heartbeat: null,
          last_code_at: 0
        })
        .execute();

      const row = await tx
        .selectFrom("sessions")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      return { session: rowToSession(row), rawApiKey: raw };
    });
  }

  async getByApiKeyHash(hash: string): Promise<Session | null> {
    const row = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("api_key_hash", "=", hash)
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async getActiveByChatId(chatId: number): Promise<Session | null> {
    const row = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("chat_id", "=", chatId)
      .where("status", "=", "active")
      .executeTakeFirst();
    return row ? rowToSession(row) : null;
  }

  async updateHeartbeat(sessionId: string): Promise<void> {
    await this.db
      .updateTable("sessions")
      .set({ last_heartbeat: this.now() })
      .where("id", "=", sessionId)
      .execute();
  }

  /**
   * Atomic rate limit check. Returns true if accepted (row updated),
   * false if the caller is within the 1-second window.
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
}
