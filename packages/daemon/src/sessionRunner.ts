import { stripAnsi } from "./ansi.js";
import type { CodexReasoningEffort, MessageKind } from "@chatcoder/shared";
import { MAX_RESPONSE_BYTES } from "@chatcoder/shared";
import type { Profile } from "./profile.js";
import type { ToolExecutor } from "./toolExecutor.js";
import { extractResponseFromJSON } from "./summary.js";
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
const DEFAULT_RESPONSE_CHUNK_MAX_CHARS = 3_500;
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
  /**
   * Set to true when a non-stop task is executing and cleared once the final
   * response POST to the bot has succeeded. The Orchestrator polls this
   * (via SessionManager.hasPendingFinalAcks) and, if set, sends
   * `resumeInProgress=true` on the next poll so the bot hands back the same
   * in-progress row instead of wedging the session. This recovers from a
   * swallowed final-POST failure: the bot's `completeProcessing` was never
   * called, so without the resume poll every subsequent message for this
   * session would be blocked behind the stuck row forever.
   */
  private pendingFinalAck = false;

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

  /**
   * True when a non-stop task is in flight and the bot has not yet
   * acknowledged the final response. Used by the Orchestrator to decide
   * whether to send `resumeInProgress=true` on the next poll so the bot
   * hands back the same in-progress row instead of wedging the session.
   */
  get hasPendingFinalAck(): boolean {
    return this.pendingFinalAck;
  }

  /**
   * Update the profile used by this runner. Called when the session's profile
   * is changed via the Telegram menu while the runner is still alive.
   */
  updateProfile(profile: Profile): void {
    this.deps.profile = profile;
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
    // Stops don't need a final ack — the abort path is its own confirmation
    // (the bot's "⏹ Stopped" message completes the row when it lands).
    // pendingFinalAck is flipped on only when a final POST actually fails
    // (see tryPostChunked callers below): setting it eagerly here would
    // make the orchestrator poll the bot with resumeInProgress=1 for the
    // entire duration of a normal task, which causes the bot to hand back
    // a "continue" resume task per poll while the task is still running —
    // the runner then drains a flood of spurious "continue" turns after
    // the original task completes.
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
        const ok = await this.tryPostChunked(task.sessionId, `Error: ${err instanceof Error ? err.message : String(err)}`, { final: true });
        // The flag is sticky on failure (orchestrator keeps asking the bot
        // to resume the in-progress row until the next successful final
        // POST clears it). Successful POSTs leave the flag at whatever it
        // was before — typically false, but possibly true if a previous
        // task's final POST failed and we are now finally clearing it.
        if (ok) this.pendingFinalAck = false;
        else this.pendingFinalAck = true;
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

      // Safety timer: release flushInFlight even if the HTTP call stalls
      // (defense in depth — ApiClient.request() also has its own timeout).
      const safetyTimer = this.setTimer(() => {
        if (flushInFlight) {
          this.log("progress flush safety release", { session: this.sessionId });
          flushInFlight = false;
        }
      }, this.updateMs * 2);

      try {
        await flushPendingProgress();
      } catch (err) {
        this.log("progress response failed", { session: this.sessionId, err });
      } finally {
        this.clearTimer(safetyTimer);
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
        // No output at all — still complete the task so the DB row is cleaned
        // up and the next queued instruction can be claimed.
        const ok = await this.tryPostChunked(task.sessionId, "(no output)", { final: true });
        if (ok) this.pendingFinalAck = false;
        else this.pendingFinalAck = true;
        return;
      }

      // Try to extract a JSON response, or fall back to the raw output
      const responseText = extractResponseFromJSON(rawText);
      const finalContent = responseText ?? rawText;
      const formatted = convert(finalContent).trim();
      const ok = await this.tryPostChunked(task.sessionId, formatted, { final: true });
      if (ok) this.pendingFinalAck = false;
      else this.pendingFinalAck = true;
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
    if (opts.final && outboundText.length <= MAX_RESPONSE_BYTES) {
      this.log(">>> response", { session: this.sessionId, chunk: outboundText });
      await this.deps.postResponse(sessionId, outboundText, opts);
      return;
    }
    // Chunk content that exceeds the server's Zod body limit (MAX_RESPONSE_BYTES).
    // For non-final (progress) chunks this is normal — Telegram has a 4096 char
    // message limit, so progress chunks still use chunkMax for the display.  For
    // oversized finals we send the first N-1 chunks as progress updates and the
    // last chunk as the actual final response carrying the FULL text — so
    // response.txt always contains the complete answer.
    const displayLimit = this.chunkMax;
    const chunks: string[] = [];
    for (let i = 0; i < outboundText.length; i += displayLimit) {
      chunks.push(outboundText.slice(i, i + displayLimit));
    }
    const isOversizedFinal = opts.final && chunks.length > 1;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkOpts = isOversizedFinal
        ? { final: ci === chunks.length - 1 }
        : opts;
      if (isOversizedFinal) {
        this.log(">>> response (oversized chunk)", {
          session: this.sessionId,
          chunk: ci + 1,
          total: chunks.length,
          final: chunkOpts.final
        });
      } else {
        this.log(">>> response", { session: this.sessionId, chunk: chunks[ci] });
      }
      // The last chunk of an oversized final carries the FULL text so
      // response.txt (built from state.response on the bot side) contains
      // the complete response, not just the last fragment.
      const content =
        isOversizedFinal && ci === chunks.length - 1
          ? outboundText
          : chunks[ci]!;
      await this.deps.postResponse(sessionId, content, chunkOpts);
    }
  }

  private async tryPostChunked(
    sessionId: string,
    text: string,
    opts: { final?: boolean } = {}
  ): Promise<boolean> {
    try {
      await this.postChunked(sessionId, text, opts);
      return true;
    } catch (err) {
      this.log("response post failed", { session: this.sessionId, err });
      return false;
    }
  }
}
