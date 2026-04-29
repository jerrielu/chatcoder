import type { CodexReasoningEffort } from "@chatcoder/shared";
import type { Profile } from "./profile.js";
import type { ToolExecutor } from "./toolExecutor.js";
export interface ProfileRunnerTask {
    sessionId: string;
    messageId: string;
    content: string;
    resumeLastSession?: boolean;
    codexReasoningEffort?: CodexReasoningEffort;
    interrupt?: boolean;
}
export interface ProfileRunnerDeps {
    profile: Profile;
    tool: ToolExecutor;
    /** Posts a final response or progress update back to the bot for a given session. */
    postResponse: (sessionId: string, content: string, opts?: {
        final?: boolean;
    }) => Promise<void>;
    /** Logging. */
    log?: (msg: string, extra?: unknown) => void;
    /** Acquire a slot in the global concurrency pool; returns a release fn. */
    acquireSlot?: () => Promise<() => void>;
    /** Timer injection for tests. */
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    responseUpdateIntervalMs?: number;
    responseChunkMaxChars?: number;
}
/**
 * Per-profile FIFO runner. Instructions for the same profile are executed in
 * arrival order (serial), which matches the "don't race on the same cwd"
 * invariant. Different ProfileRunner instances run in parallel, bounded by
 * the global concurrency semaphore in ProfilePool.
 */
export declare class ProfileRunner {
    private readonly deps;
    private readonly queue;
    private running;
    private stopping;
    private currentAbort;
    private activeTaskId;
    private readonly supersededTaskIds;
    private readonly log;
    private readonly setTimer;
    private readonly clearTimer;
    private readonly updateMs;
    private readonly chunkMax;
    private idlePromise;
    private idleResolve;
    constructor(deps: ProfileRunnerDeps);
    get profileName(): string;
    get pending(): number;
    enqueue(task: ProfileRunnerTask): void;
    /** Wait for the current queue to be fully processed. */
    whenIdle(): Promise<void>;
    stop(): Promise<void>;
    private armIdlePromise;
    private settleIdle;
    private drain;
    private runOne;
    private executeWithOutputUpdates;
    private postChunked;
    private tryPostChunked;
}
//# sourceMappingURL=profileRunner.d.ts.map