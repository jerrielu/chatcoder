import { stripAnsi } from "./ansi.js";
import type { Profile } from "./profile.js";
import type { ToolExecutor } from "./toolExecutor.js";

export interface ProfileRunnerTask {
  sessionId: string;
  messageId: string;
  content: string;
  resumeLastSession?: boolean;
  interrupt?: boolean;
}

export interface ProfileRunnerDeps {
  profile: Profile;
  tool: ToolExecutor;
  /** Posts a final response or progress update back to the bot for a given session. */
  postResponse: (
    sessionId: string,
    content: string,
    opts?: { final?: boolean }
  ) => Promise<void>;
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
const PROGRESS_WORD_LIMIT = 50;

function firstWords(text: string, limit: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, limit).join(" ");
}

function formatProgressUpdate(text: string): string {
  const timestamp = new Date().toISOString();
  const preview = firstWords(text, PROGRESS_WORD_LIMIT);
  return preview.length > 0 ? `[${timestamp}] ${preview}` : `[${timestamp}]`;
}

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
  private currentAbort: AbortController | null = null;
  private activeTaskId: string | null = null;
  private readonly supersededTaskIds = new Set<string>();
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
    if (task.interrupt) {
      for (const queued of this.queue) {
        this.supersededTaskIds.add(queued.messageId);
      }
      if (this.activeTaskId) {
        this.supersededTaskIds.add(this.activeTaskId);
      }
      this.queue.splice(0, this.queue.length, task);
      this.currentAbort?.abort();
    } else {
      this.queue.push(task);
    }
    if (!this.running) {
      this.armIdlePromise();
      void this.drain().catch((err) => {
        this.log("profile runner drain failed", { profile: this.profileName, err });
        this.running = false;
        this.settleIdle();
      });
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
    let release: (() => void) | null = null;
    this.activeTaskId = task.messageId;
    try {
      release = this.deps.acquireSlot ? await this.deps.acquireSlot() : null;
      if (this.supersededTaskIds.delete(task.messageId)) return;
      this.log("<<< instruction", { profile: this.profileName, session: task.sessionId, content: task.content });
      const abort = new AbortController();
      this.currentAbort = abort;
      try {
        await this.executeWithOutputUpdates(task, abort.signal);
      } catch (err) {
        if (abort.signal.aborted) return;
        this.log("execution failed", { profile: this.profileName, err });
        await this.tryPostChunked(task.sessionId, `Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (this.currentAbort === abort) this.currentAbort = null;
      }
    } finally {
      if (this.activeTaskId === task.messageId) this.activeTaskId = null;
      this.supersededTaskIds.delete(task.messageId);
      release?.();
    }
  }

  private async executeWithOutputUpdates(task: ProfileRunnerTask, signal: AbortSignal): Promise<void> {
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    let flushInFlight = false;
    let rawOutput = "";
    let emittedChars = 0;

    const collectPending = (): string => {
      const sanitized = stripAnsi(rawOutput);
      if (sanitized.length <= emittedChars) return "";
      const next = sanitized.slice(emittedChars);
      emittedChars = sanitized.length;
      return next;
    };

    const flushPendingProgress = async (): Promise<void> => {
      const next = collectPending();
      if (next.length === 0) return;
      await this.tryPostChunked(task.sessionId, next, { final: false });
    };

    const schedule = (): void => {
      if (finished || this.stopping || signal.aborted) return;
      updateTimer = this.setTimer(() => void tick(), this.updateMs);
    };

    const tick = async (): Promise<void> => {
      if (finished || this.stopping || signal.aborted) return;
      schedule();
      if (flushInFlight) return;
      flushInFlight = true;
      try {
        await flushPendingProgress();
      } catch (err) {
        this.log("progress response failed", { profile: this.profileName, session: task.sessionId, err });
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
        signal,
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

      collectPending();
      if (signal.aborted) return;
      const finalText = finalOutput.length > 0 ? finalOutput : stripAnsi(rawOutput).trim();
      if (finalText.length > 0) {
        await this.tryPostChunked(task.sessionId, finalText, { final: true });
      }
    } finally {
      finished = true;
      if (updateTimer) {
        this.clearTimer(updateTimer);
        updateTimer = null;
      }
    }
  }

  private async postChunked(
    sessionId: string,
    text: string,
    opts: { final?: boolean } = {}
  ): Promise<void> {
    if (!text) return;
    const outboundText = opts.final === false ? formatProgressUpdate(text) : text;
    for (let i = 0; i < outboundText.length; i += this.chunkMax) {
      const chunk = outboundText.slice(i, i + this.chunkMax);
      this.log(">>> response", { profile: this.profileName, session: sessionId, chunk });
      await this.deps.postResponse(sessionId, chunk, opts);
    }
  }

  private async tryPostChunked(
    sessionId: string,
    text: string,
    opts: { final?: boolean } = {}
  ): Promise<void> {
    try {
      await this.postChunked(sessionId, text, opts);
    } catch (err) {
      this.log("response post failed", { profile: this.profileName, session: sessionId, err });
    }
  }
}
