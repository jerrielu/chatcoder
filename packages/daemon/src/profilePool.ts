import type { Profile } from "./profile.js";
import { ProfileRunner, type ProfileRunnerTask } from "./profileRunner.js";
import type { ToolExecutor } from "./toolExecutor.js";

export interface ProfilePoolDeps {
  profiles: Profile[];
  tool: ToolExecutor;
  postResponse: (
    sessionId: string,
    content: string,
    opts?: { final?: boolean }
  ) => Promise<void>;
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
export class ProfilePool {
  private readonly runners = new Map<string, ProfileRunner>();
  private inflight = 0;
  private readonly maxConcurrency: number;
  private readonly waiters: Array<() => void> = [];

  constructor(deps: ProfilePoolDeps) {
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

  hasProfile(name: string): boolean {
    return this.runners.has(name);
  }

  enqueue(profileName: string, task: ProfileRunnerTask): boolean {
    const runner = this.runners.get(profileName);
    if (!runner) return false;
    runner.enqueue(task);
    return true;
  }

  runnerNames(): string[] {
    return [...this.runners.keys()];
  }

  async drainAll(): Promise<void> {
    await Promise.all([...this.runners.values()].map((r) => r.whenIdle()));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.runners.values()].map((r) => r.stop()));
  }

  private async acquire(): Promise<() => void> {
    if (this.inflight < this.maxConcurrency) {
      this.inflight++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inflight++;
    return () => this.release();
  }

  private release(): void {
    this.inflight--;
    const next = this.waiters.shift();
    if (next) next();
  }
}
