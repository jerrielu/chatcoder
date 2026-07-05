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
export declare class SessionsRepo {
    private readonly db;
    private readonly now;
    constructor(db: Db, now?: () => number);
    /**
     * Create a session for (chat_id, api_key_id, profile_id).
     * If an active session already exists for the same chat_id, it is revoked
     * first — a chat may hold at most one active session.
     * If an active session already exists for the same triple, return it
     * unchanged (no-op).
     */
    create(args: {
        chatId: number;
        apiKeyId: string;
        profileId: string;
        workDir?: string;
    }): Promise<Session>;
    getById(id: string): Promise<Session | null>;
    /** Active session for a chat, or null. */
    getActiveByChatId(chatId: number): Promise<Session | null>;
    /** @deprecated Use getActiveByChatId — only one active session per chat. */
    getLatestActiveByChatId(chatId: number): Promise<Session | null>;
    listActiveByApiKey(apiKeyId: string): Promise<Session[]>;
    listActiveByChatId(chatId: number): Promise<Session[]>;
    revoke(id: string): Promise<boolean>;
    delete(id: string): Promise<boolean>;
    /**
     * Atomic rate limit check. Returns true if accepted (row updated),
     * false if the caller is within the 1-second window. Rate-limit is
     * per-session so different profiles aren't throttled by each other.
     */
    tryConsumeRate(sessionId: string): Promise<boolean>;
    setLatestMessage(sessionId: string, content: string | null): Promise<boolean>;
    setProfile(sessionId: string, profileId: string): Promise<boolean>;
    setWorkDir(sessionId: string, workDir: string | null): Promise<void>;
}
//# sourceMappingURL=sessions.d.ts.map