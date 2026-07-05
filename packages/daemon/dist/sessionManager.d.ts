import { type SessionRunnerTask } from "./sessionRunner.js";
import type { ToolExecutor } from "./toolExecutor.js";
import type { Profile } from "./profile.js";
import type { DaemonConfig } from "./config.js";
export interface SessionManagerDeps {
    config: DaemonConfig;
    tool: ToolExecutor;
    postResponse: (sessionId: string, content: string, opts?: {
        final?: boolean;
    }) => Promise<void>;
    log?: (msg: string, extra?: unknown) => void;
    /** Max concurrent child processes across all sessions. */
    maxConcurrency?: number;
}
/**
 * Holds a SessionRunner per active session. Runners are created on demand
 * when a task arrives for a new session. A global semaphore caps the number
 * of child processes running at once across all sessions.
 */
export declare class SessionManager {
    private readonly deps;
    private readonly runners;
    private inflight;
    private readonly maxConcurrency;
    private readonly waiters;
    constructor(deps: SessionManagerDeps);
    private getOrCreateRunner;
    /**
     * Enqueue a task for the given session. If no runner exists for this
     * session yet, one is created using the profile config.
     */
    enqueue(sessionId: string, profile: Profile, task: SessionRunnerTask): boolean;
    /** List all active session ids. */
    activeSessionIds(): string[];
    drainAll(): Promise<void>;
    stop(): Promise<void>;
    private acquire;
    private release;
}
//# sourceMappingURL=sessionManager.d.ts.map