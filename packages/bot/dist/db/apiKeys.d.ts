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
export declare class ApiKeysRepo {
    private readonly db;
    private readonly now;
    constructor(db: Db, now?: () => number);
    /**
     * Idempotent register by raw API key. Creates an active row on first call;
     * returns the existing record on subsequent calls. Revoked rows for the
     * same hash are rejected (reuse of a revoked key is disallowed).
     */
    registerByRawKey(rawApiKey: string): Promise<ApiKeyRecord>;
    getByHash(hash: string): Promise<ApiKeyRecord | null>;
    getByRawKey(rawApiKey: string): Promise<ApiKeyRecord | null>;
    getById(id: string): Promise<ApiKeyRecord | null>;
    list(args?: {
        status?: "active" | "revoked";
        limit?: number;
        offset?: number;
    }): Promise<ApiKeyRecord[]>;
    count(args?: {
        status?: "active" | "revoked";
    }): Promise<number>;
    updateHeartbeat(id: string): Promise<void>;
    revoke(id: string): Promise<boolean>;
    delete(id: string): Promise<boolean>;
}
//# sourceMappingURL=apiKeys.d.ts.map