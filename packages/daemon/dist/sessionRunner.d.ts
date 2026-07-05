import type { CodexReasoningEffort, MessageKind } from "@chatcoder/shared";
import type { Profile } from "./profile.js";
import type { ToolExecutor } from "./toolExecutor.js";
export interface SessionRunnerTask {
    sessionId: string;
    messageId: string;
    kind: MessageKind;
    content: string;
    resumeLastSession?: boolean;
    codexReasoningEffort?: CodexReasoningEffort;
    workDir?: string;
}
export interface SessionRunnerDeps {
    sessionId: string;
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
 * Per-session FIFO runner. Instructions for the same session are executed in
 * arrival order (serial). Different SessionRunner instances run in parallel,
 * bounded by the global concurrency semaphore in SessionManager.
 */
export declare class SessionRunner {
    readonly sessionId: string;
    private readonly deps;
    private readonly queue;
    private running;
    private stopping;
    private currentAbort;
    private activeTaskId;
    private readonly log;
    private readonly setTimer;
    private readonly clearTimer;
    private readonly updateMs;
    private readonly chunkMax;
    private idlePromise;
    private idleResolve;
    constructor(sessionId: string, deps: SessionRunnerDeps);
    get pending(): number;
    enqueue(task: SessionRunnerTask): void;
    /** Wait for the current queue to be fully processed. */
    whenIdle(): Promise<void>;
    stop(): Promise<void>;
    private handleStop;
    private armIdlePromise;
    private settleIdle;
    private drain;
    private runOne;
    private executeWithOutputUpdates;
    private postChunked;
    private tryPostChunked;
}
//# sourceMappingURL=sessionRunner.d.ts.map