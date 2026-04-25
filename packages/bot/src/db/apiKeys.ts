import { randomUUID } from "node:crypto";
import { hashApiKey } from "./crypto.js";
import type { Db } from "./index.js";

export interface ApiKeyRecord {
  id: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  status: "active" | "revoked";
  createdAt: number;
  revokedAt: number | null;
  lastHeartbeat: number | null;
}

function rowToRecord(row: {
  id: string;
  api_key_hash: string;
  api_key_prefix: string;
  status: "active" | "revoked";
  created_at: number | string | bigint;
  revoked_at: number | string | bigint | null;
  last_heartbeat: number | string | bigint | null;
}): ApiKeyRecord {
  const n = (v: number | string | bigint | null): number | null =>
    v == null ? null : typeof v === "number" ? v : Number(v);
  return {
    id: row.id,
    apiKeyHash: row.api_key_hash,
    apiKeyPrefix: row.api_key_prefix,
    status: row.status,
    createdAt: n(row.created_at) as number,
    revokedAt: n(row.revoked_at),
    lastHeartbeat: n(row.last_heartbeat)
  };
}

export class ApiKeysRepo {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  /**
   * Idempotent register by raw API key. Creates an active row on first call;
   * returns the existing record on subsequent calls. Revoked rows for the
   * same hash are rejected (reuse of a revoked key is disallowed).
   */
  async registerByRawKey(rawApiKey: string): Promise<ApiKeyRecord> {
    const hash = hashApiKey(rawApiKey);
    const existing = await this.getByHash(hash);
    if (existing) {
      if (existing.status === "revoked") {
        throw new Error("This API key has been revoked; generate a new one.");
      }
      return existing;
    }
    const id = randomUUID();
    await this.db
      .insertInto("api_keys")
      .values({
        id,
        api_key_hash: hash,
        api_key_prefix: rawApiKey.slice(0, 8),
        status: "active",
        created_at: this.now(),
        revoked_at: null,
        last_heartbeat: null
      })
      .execute();
    const row = await this.db
      .selectFrom("api_keys")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    return rowToRecord(row);
  }

  async getByHash(hash: string): Promise<ApiKeyRecord | null> {
    const row = await this.db
      .selectFrom("api_keys")
      .selectAll()
      .where("api_key_hash", "=", hash)
      .executeTakeFirst();
    return row ? rowToRecord(row) : null;
  }

  async getByRawKey(rawApiKey: string): Promise<ApiKeyRecord | null> {
    return this.getByHash(hashApiKey(rawApiKey));
  }

  async getById(id: string): Promise<ApiKeyRecord | null> {
    const row = await this.db
      .selectFrom("api_keys")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? rowToRecord(row) : null;
  }

  async list(args: { status?: "active" | "revoked"; limit?: number; offset?: number } = {}): Promise<ApiKeyRecord[]> {
    let q = this.db.selectFrom("api_keys").selectAll().orderBy("created_at", "desc");
    if (args.status) q = q.where("status", "=", args.status);
    if (args.limit !== undefined) q = q.limit(args.limit);
    if (args.offset !== undefined) q = q.offset(args.offset);
    const rows = await q.execute();
    return rows.map(rowToRecord);
  }

  async count(args: { status?: "active" | "revoked" } = {}): Promise<number> {
    let q = this.db.selectFrom("api_keys").select(({ fn }) => fn.count("id").as("c"));
    if (args.status) q = q.where("status", "=", args.status);
    const res = await q.executeTakeFirst();
    return Number(res?.c ?? 0);
  }

  async updateHeartbeat(id: string): Promise<void> {
    await this.db
      .updateTable("api_keys")
      .set({ last_heartbeat: this.now() })
      .where("id", "=", id)
      .execute();
  }

  async revoke(id: string): Promise<boolean> {
    const res = await this.db
      .updateTable("api_keys")
      .set({ status: "revoked", revoked_at: this.now() })
      .where("id", "=", id)
      .where("status", "=", "active")
      .executeTakeFirst();
    return Number(res.numUpdatedRows) > 0;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .deleteFrom("api_keys")
      .where("id", "=", id)
      .executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  }
}
