import { SessionRunner } from "./sessionRunner.js";
/**
 * Holds a SessionRunner per active session. Runners are created on demand
 * when a task arrives for a new session. A global semaphore caps the number
 * of child processes running at once across all sessions.
 */
export class SessionManager {
    deps;
    runners = new Map();
    inflight = 0;
    maxConcurrency;
    waiters = [];
    constructor(deps) {
        this.deps = deps;
        this.maxConcurrency = Math.max(1, deps.maxConcurrency ?? 4);
    }
    getOrCreateRunner(sessionId, profile) {
        let runner = this.runners.get(sessionId);
        if (!runner) {
            runner = new SessionRunner(sessionId, {
                sessionId,
                profile,
                tool: this.deps.tool,
                postResponse: this.deps.postResponse,
                log: this.deps.log,
                acquireSlot: () => this.acquire()
            });
            this.runners.set(sessionId, runner);
        }
        return runner;
    }
    /**
     * Enqueue a task for the given session. If no runner exists for this
     * session yet, one is created using the profile config.
     */
    enqueue(sessionId, profile, task) {
        const runner = this.getOrCreateRunner(sessionId, profile);
        runner.enqueue(task);
        return true;
    }
    /** List all active session ids. */
    activeSessionIds() {
        return [...this.runners.keys()];
    }
    async drainAll() {
        await Promise.all([...this.runners.values()].map((r) => r.whenIdle()));
    }
    async stop() {
        await Promise.all([...this.runners.values()].map((r) => r.stop()));
    }
    async acquire() {
        if (this.inflight < this.maxConcurrency) {
            this.inflight++;
            return () => this.release();
        }
        await new Promise((resolve) => this.waiters.push(resolve));
        this.inflight++;
        return () => this.release();
    }
    release() {
        this.inflight--;
        const next = this.waiters.shift();
        if (next)
            next();
    }
}
//# sourceMappingURL=sessionManager.js.map