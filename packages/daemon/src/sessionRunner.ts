import { stripAnsi } from "./ansi.js";
import type { CodexReasoningEffort, MessageKind } from "@chatcoder/shared";
import type { Profile } from "./profile.js";
import { RESPONSE_INSTRUCTION, type ToolExecutor } from "./toolExecutor.js";
import { extractResponseFromJSON, extractLastBlock } from "./summary.js";
import { convert } from "telegram-markdown-v2";

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
 * Per-session FIFO runner. Instructions for the same session are executed in
 * arrival order (serial). Different SessionRunner instances run in parallel,
 * bounded by the global concurrency semaphore in SessionManager.
 */
export class SessionRunner {
  private readonly queue: SessionRunnerTask[] = [];
  private running = false;
  private stopping = false;
  private currentAbort: AbortController | null = null;
  private activeTaskId: string | null = null;
  private readonly log: (m: string, extra?: unknown) => void;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly updateMs: number;
  private readonly chunkMax: number;
  private idlePromise: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  constructor(
    public readonly sessionId: string,
    private readonly deps: SessionRunnerDeps
  ) {
    this.log = deps.log ?? (() => void 0);
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
    this.updateMs = deps.responseUpdateIntervalMs ?? DEFAULT_RESPONSE_UPDATE_INTERVAL_MS;
    this.chunkMax = deps.responseChunkMaxChars ?? DEFAULT_RESPONSE_CHUNK_MAX_CHARS;
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  enqueue(task: SessionRunnerTask): void {
    if (this.stopping) return;

    // Stop messages are handled immediately — abort current execution and complete
    if (task.kind === "stop") {
      void this.handleStop(task);
      return;
    }

    this.queue.push(task);
    if (!this.running) {
      this.armIdlePromise();
      void this.drain().catch((err) => {
        this.log("session runner drain failed", { session: this.sessionId, err });
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
    this.currentAbort?.abort();
    await this.idlePromise;
  }

  private async handleStop(task: SessionRunnerTask): Promise<void> {
    // Abort any running execution
    if (this.currentAbort && this.activeTaskId) {
      const abortedId = this.activeTaskId;
      this.currentAbort.abort();
      // Send a final response for the aborted task so the server completes it
      await this.tryPostChunked(this.sessionId, "⏹ Stopped", { final: true });
      this.activeTaskId = null;
    }
    // Complete the stop message itself
    await this.tryPostChunked(this.sessionId, "⏹ Stopped", { final: true });
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

  private async runOne(task: SessionRunnerTask): Promise<void> {
    let release: (() => void) | null = null;
    this.activeTaskId = task.messageId;
    try {
      release = this.deps.acquireSlot ? await this.deps.acquireSlot() : null;
      this.log("<<< instruction", { session: this.sessionId, profile: this.deps.profile.name, content: task.content });
      const abort = new AbortController();
      this.currentAbort = abort;
      try {
        await this.executeWithOutputUpdates(task, abort.signal);
      } catch (err) {
        if (abort.signal.aborted) return;
        this.log("execution failed", { session: this.sessionId, err });
        await this.tryPostChunked(task.sessionId, `Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (this.currentAbort === abort) this.currentAbort = null;
      }
    } finally {
      if (this.activeTaskId === task.messageId) this.activeTaskId = null;
      release?.();
    }
  }

  private async executeWithOutputUpdates(task: SessionRunnerTask, signal: AbortSignal): Promise<void> {
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
        this.log("progress response failed", { session: this.sessionId, err });
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
      if (rawText.length === 0) return;

      // Try to extract a JSON summary from the tool's output
      let responseText = extractResponseFromJSON(rawText);

      if (responseText) {
        const formatted = convert(responseText).trim();
        await this.tryPostChunked(task.sessionId, formatted, { final: true });
      } else if (this.deps.profile.tool === "REASONIX") {
        // REASONIX doesn't use RESPONSE_INSTRUCTION — post the raw output directly
        const fallback = extractLastBlock(rawText);
        const formatted = convert(fallback || rawText).trim();
        await this.tryPostChunked(task.sessionId, formatted, { final: true });
      } else {
        // Retry up to 3 times asking the AI to produce a summary
        let context = rawText.slice(0, 3_000);
        let success = false;
        for (let attempt = 0; attempt < 3 && !success && !signal.aborted; attempt++) {
          const retryMsg = `${RESPONSE_INSTRUCTION}\n\n${context}`;
          try {
            const retryResult = await this.deps.tool.execute(this.deps.profile, retryMsg, {
              resumeLastSession: false,
              skipResponseWrapper: true
            });
            const retryResponse = extractResponseFromJSON(retryResult);
            if (retryResponse) {
              const formatted = convert(retryResponse).trim();
              await this.tryPostChunked(task.sessionId, formatted, { final: true });
              success = true;
            } else {
              context = retryResult.slice(0, 3_000);
            }
          } catch (err) {
            this.log("summary retry failed", { session: this.sessionId, attempt, err });
            context = String(err).slice(0, 3_000);
          }
        }
        if (!success) {
          const fallback = extractLastBlock(rawText);
          const formatted = convert(fallback || rawText).trim();
          await this.tryPostChunked(task.sessionId, formatted, { final: true });
        }
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
      this.log(">>> response", { session: this.sessionId, chunk });
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
      this.log("response post failed", { session: this.sessionId, err });
    }
  }
}
