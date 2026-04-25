import { stripAnsi } from "./ansi.js";
import type { Profile } from "./profile.js";
import type { ToolExecutor } from "./toolExecutor.js";

export interface ProfileRunnerTask {
  sessionId: string;
  messageId: string;
  content: string;
  resumeLastSession?: boolean;
}

export interface ProfileRunnerDeps {
  profile: Profile;
  tool: ToolExecutor;
  /** Posts a response chunk back to the bot for a given session. */
  postResponse: (sessionId: string, content: string) => Promise<void>;
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

const DEFAULT_RESPONSE_UPDATE_INTERVAL_MS = 5_000;
const DEFAULT_RESPONSE_CHUNK_MAX_CHARS = 4_095;

/**
 * Per-profile FIFO runner. Instructions for the same profile are executed in
 * arrival order (serial), which matches the "don't race on the same cwd"
 * invariant. Different ProfileRunner instances run in parallel, bounded by
 * the global concurrency semaphore in ProfilePool.
 */
export class ProfileRunner {
  private readonly queue: ProfileRunnerTask[] = [];
  private running = false;
  private stopping = false;
  private readonly log: (m: string, extra?: unknown) => void;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly updateMs: number;
  private readonly chunkMax: number;
  private idlePromise: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  constructor(private readonly deps: ProfileRunnerDeps) {
    this.log = deps.log ?? (() => void 0);
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
    this.updateMs = deps.responseUpdateIntervalMs ?? DEFAULT_RESPONSE_UPDATE_INTERVAL_MS;
    this.chunkMax = deps.responseChunkMaxChars ?? DEFAULT_RESPONSE_CHUNK_MAX_CHARS;
  }

  get profileName(): string {
    return this.deps.profile.name;
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  enqueue(task: ProfileRunnerTask): void {
    if (this.stopping) return;
    this.queue.push(task);
    if (!this.running) {
      this.armIdlePromise();
      void this.drain();
    }
  }

  /** Wait for the current queue to be fully processed. */
  async whenIdle(): Promise<void> {
    return this.idlePromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.idlePromise;
  }

  private armIdlePromise(): void {
    if (this.idleResolve) return;
    this.idlePromise = new Promise<void>((resolve) => {
      this.idleResolve = resolve;
    });
  }

  private settleIdle(): void {
    const r = this.idleResolve;
    this.idleResolve = null;
    if (r) r();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        await this.runOne(task);
      }
    } finally {
      this.running = false;
      this.settleIdle();
    }
  }

  private async runOne(task: ProfileRunnerTask): Promise<void> {
    const release = this.deps.acquireSlot ? await this.deps.acquireSlot() : null;
    try {
      this.log("<<< instruction", { profile: this.profileName, session: task.sessionId, content: task.content });
      try {
        await this.executeWithOutputUpdates(task);
      } catch (err) {
        this.log("execution failed", { profile: this.profileName, err });
        await this.postChunked(task.sessionId, `Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      release?.();
    }
  }

  private async executeWithOutputUpdates(task: ProfileRunnerTask): Promise<void> {
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let flushInFlight = false;
    let rawOutput = "";
    let emittedChars = 0;
    let postedAny = false;

    const collectPending = (): string => {
      const sanitized = stripAnsi(rawOutput);
      if (sanitized.length <= emittedChars) return "";
      const next = sanitized.slice(emittedChars);
      emittedChars = sanitized.length;
      return next;
    };

    const flushPending = async (): Promise<void> => {
      const next = collectPending();
      if (next.length === 0) return;
      await this.postChunked(task.sessionId, next);
      postedAny = true;
    };

    const schedule = (): void => {
      if (finished || this.stopping) return;
      updateTimer = this.setTimer(() => void tick(), this.updateMs);
    };

    const tick = async (): Promise<void> => {
      if (finished || this.stopping) return;
      schedule();
      if (flushInFlight) return;
      flushInFlight = true;
      try {
        await flushPending();
      } finally {
        flushInFlight = false;
      }
    };

    schedule();
    try {
      const finalOutput = await this.deps.tool.execute(this.deps.profile, task.content, {
        onOutput: (chunk) => {
          rawOutput += chunk;
        },
        resumeLastSession: task.resumeLastSession ?? true
      });
      finished = true;
      if (updateTimer) {
        this.clearTimer(updateTimer);
        updateTimer = null;
      }

      const deadline = Date.now() + 5_000;
      while (flushInFlight && Date.now() < deadline) {
        await new Promise((r) => this.setTimer(() => r(undefined), 10));
      }

      await flushPending();
      if (!postedAny && finalOutput.length > 0) {
        await this.postChunked(task.sessionId, finalOutput);
      }
    } finally {
      finished = true;
      if (updateTimer) {
        this.clearTimer(updateTimer);
        updateTimer = null;
      }
    }
  }

  private async postChunked(sessionId: string, text: string): Promise<void> {
    if (!text) return;
    for (let i = 0; i < text.length; i += this.chunkMax) {
      const chunk = text.slice(i, i + this.chunkMax);
      this.log(">>> response", { profile: this.profileName, session: sessionId, chunk });
      await this.deps.postResponse(sessionId, chunk);
    }
  }
}
