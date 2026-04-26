import { ProfileRunner } from "./profileRunner.js";
/**
 * Holds a ProfileRunner per configured profile and a global semaphore that
 * caps the number of child processes running at once. Dispatching an
 * instruction is O(1) — the runner's internal queue enforces per-profile
 * FIFO order.
 */
export class ProfilePool {
    runners = new Map();
    inflight = 0;
    maxConcurrency;
    waiters = [];
    constructor(deps) {
        this.maxConcurrency = Math.max(1, deps.maxConcurrency ?? 4);
        for (const p of deps.profiles) {
            const runner = new ProfileRunner({
                profile: p,
                tool: deps.tool,
                postResponse: deps.postResponse,
                log: deps.log,
                acquireSlot: () => this.acquire()
            });
            this.runners.set(p.name, runner);
        }
    }
    hasProfile(name) {
        return this.runners.has(name);
    }
    enqueue(profileName, task) {
        const runner = this.runners.get(profileName);
        if (!runner)
            return false;
        runner.enqueue(task);
        return true;
    }
    runnerNames() {
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
//# sourceMappingURL=profilePool.js.map