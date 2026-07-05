import type { CodexReasoningEffort, MessageKind } from "@chatcoder/shared";
import type { Db } from "./index.js";
export interface QueuedMessage {
    id: string;
    sessionId: string;
    content: string;
    resumeLastSession: boolean;
    codexReasoningEffort?: CodexReasoningEffort;
    kind: MessageKind;
    processingStartedAt: number | null;
    createdAt: number;
}
export interface EnqueueResult {
    message: QueuedMessage;
    droppedOldestId: string | null;
}
export declare class MessagesRepo {
    private readonly db;
    private readonly now;
    /**
     * Monotonic counter mixed into created_at at sub-millisecond resolution so
     * two enqueues that land in the same `now()` tick retain their call order.
     * We shift created_at by 10 bits and OR in a bounded sequence — the SQL
     * column stays a simple BIGINT.
     */
    private seq;
    constructor(db: Db, now?: () => number);
    private nextStamp;
    /**
     * Enqueue an instruction for the daemon; enforces per-session cap of
     * MAX_QUEUE_DEPTH by dropping the oldest.
     */
    enqueue(args: {
        sessionId: string;
        content: string;
        kind?: MessageKind;
        resumeLastSession?: boolean;
        codexReasoningEffort?: CodexReasoningEffort;
    }): Promise<EnqueueResult>;
    /** Pop ALL pending instructions for a session (legacy tests/admin helpers). */
    drain(sessionId: string): Promise<QueuedMessage[]>;
    /**
     * Claim the next queued instruction for a session. If another instruction is
     * already in progress, no new work is claimed for that session.
     */
    claimNext(sessionId: string): Promise<QueuedMessage | null>;
    /**
     * Claim the next queued stop message for a session, even if another
     * instruction is currently in progress. Returns null if no stop message
     * is waiting.
     */
    claimStop(sessionId: string): Promise<QueuedMessage | null>;
    /**
     * Claim the newest queued "New Code" instruction for a session. Everything
     * older than it is cleared, including any currently in-progress instruction.
     * Newer queued instructions remain pending and will run after it.
     */
    claimLatestNewCodeAndClearBefore(sessionId: string): Promise<QueuedMessage | null>;
    getProcessing(sessionId: string): Promise<QueuedMessage | null>;
    completeProcessing(sessionId: string): Promise<boolean>;
    count(sessionId: string): Promise<number>;
    /** Remove all messages for a session (used when revoking). */
    purgeSession(sessionId: string): Promise<void>;
}
//# sourceMappingURL=messages.d.ts.map