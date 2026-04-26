import type { Profile } from "./profile.js";
import { type ProfileRunnerTask } from "./profileRunner.js";
import type { ToolExecutor } from "./toolExecutor.js";
export interface ProfilePoolDeps {
    profiles: Profile[];
    tool: ToolExecutor;
    postResponse: (sessionId: string, content: string, opts?: {
        final?: boolean;
    }) => Promise<void>;
    log?: (msg: string, extra?: unknown) => void;
    /** Max concurrent child processes across all runners. */
    maxConcurrency?: number;
}
/**
 * Holds a ProfileRunner per configured profile and a global semaphore that
 * caps the number of child processes running at once. Dispatching an
 * instruction is O(1) — the runner's internal queue enforces per-profile
 * FIFO order.
 */
export declare class ProfilePool {
    private readonly runners;
    private inflight;
    private readonly maxConcurrency;
    private readonly waiters;
    constructor(deps: ProfilePoolDeps);
    hasProfile(name: string): boolean;
    enqueue(profileName: string, task: ProfileRunnerTask): boolean;
    runnerNames(): string[];
    drainAll(): Promise<void>;
    stop(): Promise<void>;
    private acquire;
    private release;
}
//# sourceMappingURL=profilePool.d.ts.map