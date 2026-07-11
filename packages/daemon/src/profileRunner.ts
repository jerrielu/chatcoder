import { stripAnsi } from "./ansi.js";
import type { CodexReasoningEffort } from "@chatcoder/shared";
import type { Profile } from "./profile.js";
import type { ToolExecutor } from "./toolExecutor.js";
import { extractResponseFromJSON } from "./summary.js";
import { convert } from "telegram-markdown-v2";

export interface ProfileRunnerTask {
  sessionId: string;
  messageId: string;
  content: string;
  resumeLastSession?: boolean;
  codexReasoningEffort?: CodexReasoningEffort;
  workDir?: string;
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
        await this.tryPostChunked(task.sessionId, `Error: ${err instanceof Error ? err.message : String(err)}`, { final: true });
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
        resumeLastSession: task.resumeLastSession ?? true,
        codexReasoningEffort: task.codexReasoningEffort,
        workDir: task.workDir
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

      const rawText = finalOutput.length > 0 ? finalOutput : stripAnsi(rawOutput).trim();
      if (rawText.length === 0) {
        await this.tryPostChunked(task.sessionId, "(no output)", { final: true });
        return;
      }

      // Try to extract a JSON response, or fall back to the raw output
      const responseText = extractResponseFromJSON(rawText);
      const finalContent = responseText ?? rawText;
      const formatted = convert(finalContent).trim();
      await this.tryPostChunked(task.sessionId, formatted, { final: true });
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
    if (opts.final && outboundText.length <= this.chunkMax) {
      this.log(">>> response", { profile: this.profileName, session: sessionId, chunk: outboundText });
      await this.deps.postResponse(sessionId, outboundText, opts);
      return;
    }
    // Chunk content that exceeds chunkMax.  For non-final (progress) chunks this
    // is normal.  For oversized finals we send the first N-1 chunks as progress
    // updates (so they survive the 32 KB server limit) and the last chunk as the
    // actual final response — the .md attachment will only contain the last chunk
    // but the Telegram message and "Latest Progress" preserve the full history.
    const chunks: string[] = [];
    for (let i = 0; i < outboundText.length; i += this.chunkMax) {
      chunks.push(outboundText.slice(i, i + this.chunkMax));
    }
    const isOversizedFinal = opts.final && chunks.length > 1;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkOpts = isOversizedFinal
        ? { final: ci === chunks.length - 1 }
        : opts;
      if (isOversizedFinal) {
        this.log(">>> response (oversized chunk)", {
          profile: this.profileName,
          session: sessionId,
          chunk: ci + 1,
          total: chunks.length,
          final: chunkOpts.final
        });
      } else {
        this.log(">>> response", { profile: this.profileName, session: sessionId, chunk: chunks[ci] });
      }
      await this.deps.postResponse(sessionId, chunks[ci]!, chunkOpts);
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
