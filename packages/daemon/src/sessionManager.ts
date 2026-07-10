import { SessionRunner, type SessionRunnerTask } from "./sessionRunner.js";
import type { ToolExecutor } from "./toolExecutor.js";
import type { Profile } from "./profile.js";
import type { DaemonConfig } from "./config.js";

export interface SessionManagerDeps {
  config: DaemonConfig;
  tool: ToolExecutor;
  postResponse: (
    sessionId: string,
    content: string,
    opts?: { final?: boolean; rawContent?: string }
  ) => Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
  /** Max concurrent child processes across all sessions. */
  maxConcurrency?: number;
}

/**
 * Holds a SessionRunner per active session. Runners are created on demand
 * when a task arrives for a new session. A global semaphore caps the number
 * of child processes running at once across all sessions.
 */
export class SessionManager {
  private readonly runners = new Map<string, SessionRunner>();
  private inflight = 0;
  private readonly maxConcurrency: number;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly deps: SessionManagerDeps) {
    this.maxConcurrency = Math.max(1, deps.maxConcurrency ?? 4);
  }

  private getOrCreateRunner(sessionId: string, profile: Profile): SessionRunner {
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
  enqueue(sessionId: string, profile: Profile, task: SessionRunnerTask): boolean {
    const runner = this.getOrCreateRunner(sessionId, profile);
    runner.enqueue(task);
    return true;
  }

  /** List all active session ids. */
  activeSessionIds(): string[] {
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
