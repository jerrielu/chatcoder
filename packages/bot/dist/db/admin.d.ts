import type { Db } from "./index.js";
import type { Session } from "./sessions.js";
import type { ApiKeyRecord } from "./apiKeys.js";
import type { ProfileRecord } from "./profiles.js";
import type { QueuedMessage } from "./messages.js";
/** Session joined with its profile + api_key — drives the admin UI. */
export interface SessionJoined {
    session: Session;
    profile: ProfileRecord;
    apiKey: ApiKeyRecord;
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
export declare class AdminRepo {
    private readonly db;
    private readonly now;
    constructor(db: Db, now?: () => number);
    private baseJoin;
    listSessions(args?: ListSessionsArgs): Promise<SessionJoined[]>;
    countSessions(args?: ListSessionsArgs): Promise<number>;
    getSessionById(id: string): Promise<SessionJoined | null>;
    deleteSession(id: string): Promise<boolean>;
    listMessages(sessionId: string): Promise<QueuedMessage[]>;
    getMessageById(id: string): Promise<QueuedMessage | null>;
    updateMessageContent(id: string, content: string): Promise<boolean>;
    deleteMessage(id: string): Promise<boolean>;
}
//# sourceMappingURL=admin.d.ts.map