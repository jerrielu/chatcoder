import { stripAnsi } from "./ansi.js";
import { extractResponseFromJSON, extractLastBlock } from "./summary.js";
import { convert } from "telegram-markdown-v2";
const DEFAULT_RESPONSE_UPDATE_INTERVAL_MS = 5_000;
const DEFAULT_RESPONSE_CHUNK_MAX_CHARS = 4_095;
const PROGRESS_WORD_LIMIT = 50;
function firstWords(text, limit) {
    return text.trim().split(/\s+/).filter(Boolean).slice(0, limit).join(" ");
}
function formatProgressUpdate(text) {
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
    sessionId;
    deps;
    queue = [];
    running = false;
    stopping = false;
    currentAbort = null;
    activeTaskId = null;
    log;
    setTimer;
    clearTimer;
    updateMs;
    chunkMax;
    idlePromise = Promise.resolve();
    idleResolve = null;
    constructor(sessionId, deps) {
        this.sessionId = sessionId;
        this.deps = deps;
        this.log = deps.log ?? (() => void 0);
        this.setTimer = deps.setTimer ?? setTimeout;
        this.clearTimer = deps.clearTimer ?? clearTimeout;
        this.updateMs = deps.responseUpdateIntervalMs ?? DEFAULT_RESPONSE_UPDATE_INTERVAL_MS;
        this.chunkMax = deps.responseChunkMaxChars ?? DEFAULT_RESPONSE_CHUNK_MAX_CHARS;
    }
    get pending() {
        return this.queue.length + (this.running ? 1 : 0);
    }
    enqueue(task) {
        if (this.stopping)
            return;
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
    async whenIdle() {
        return this.idlePromise;
    }
    async stop() {
        this.stopping = true;
        this.currentAbort?.abort();
        await this.idlePromise;
    }
    async handleStop(task) {
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
    armIdlePromise() {
        if (this.idleResolve)
            return;
        this.idlePromise = new Promise((resolve) => {
            this.idleResolve = resolve;
        });
    }
    settleIdle() {
        const r = this.idleResolve;
        this.idleResolve = null;
        if (r)
            r();
    }
    async drain() {
        this.running = true;
        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift();
                await this.runOne(task);
            }
        }
        finally {
            this.running = false;
            this.settleIdle();
        }
    }
    async runOne(task) {
        let release = null;
        this.activeTaskId = task.messageId;
        try {
            release = this.deps.acquireSlot ? await this.deps.acquireSlot() : null;
            this.log("<<< instruction", { session: this.sessionId, profile: this.deps.profile.name, content: task.content });
            const abort = new AbortController();
            this.currentAbort = abort;
            try {
                await this.executeWithOutputUpdates(task, abort.signal);
            }
            catch (err) {
                if (abort.signal.aborted)
                    return;
                this.log("execution failed", { session: this.sessionId, err });
                await this.tryPostChunked(task.sessionId, `Error: ${err instanceof Error ? err.message : String(err)}`);
            }
            finally {
                if (this.currentAbort === abort)
                    this.currentAbort = null;
            }
        }
        finally {
            if (this.activeTaskId === task.messageId)
                this.activeTaskId = null;
            release?.();
        }
    }
    async executeWithOutputUpdates(task, signal) {
        let updateTimer = null;
        let finished = false;
        let flushInFlight = false;
        let rawOutput = "";
        let emittedChars = 0;
        const collectPending = () => {
            const sanitized = stripAnsi(rawOutput);
            if (sanitized.length <= emittedChars)
                return "";
            const next = sanitized.slice(emittedChars);
            emittedChars = sanitized.length;
            return next;
        };
        const flushPendingProgress = async () => {
            const next = collectPending();
            if (next.length === 0)
                return;
            await this.tryPostChunked(task.sessionId, next, { final: false });
        };
        const schedule = () => {
            if (finished || this.stopping || signal.aborted)
                return;
            updateTimer = this.setTimer(() => void tick(), this.updateMs);
        };
        const tick = async () => {
            if (finished || this.stopping || signal.aborted)
                return;
            schedule();
            if (flushInFlight)
                return;
            flushInFlight = true;
            try {
                await flushPendingProgress();
            }
            catch (err) {
                this.log("progress response failed", { session: this.sessionId, err });
            }
            finally {
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
            if (signal.aborted)
                return;
            const rawText = finalOutput.length > 0 ? finalOutput : stripAnsi(rawOutput).trim();
            if (rawText.length === 0)
                return;
            // Try to extract a JSON response, or fall back to the last text block
            const responseText = extractResponseFromJSON(rawText);
            const finalContent = responseText ?? extractLastBlock(rawText);
            const formatted = convert(finalContent || rawText).trim();
            await this.tryPostChunked(task.sessionId, formatted, { final: true });
        }
        finally {
            finished = true;
            if (updateTimer) {
                this.clearTimer(updateTimer);
                updateTimer = null;
            }
        }
    }
    async postChunked(sessionId, text, opts = {}) {
        if (!text)
            return;
        const outboundText = opts.final === false ? formatProgressUpdate(text) : text;
        // Final responses are sent in one shot — chunking them causes the server
        // to call completeProcessing after the first chunk, destroying the
        // processing state and truncating the .md attachment.
        if (opts.final) {
            this.log(">>> response", { session: this.sessionId, chunk: outboundText });
            await this.deps.postResponse(sessionId, outboundText, opts);
            return;
        }
        for (let i = 0; i < outboundText.length; i += this.chunkMax) {
            const chunk = outboundText.slice(i, i + this.chunkMax);
            this.log(">>> response", { session: this.sessionId, chunk });
            await this.deps.postResponse(sessionId, chunk, opts);
        }
    }
    async tryPostChunked(sessionId, text, opts = {}) {
        try {
            await this.postChunked(sessionId, text, opts);
        }
        catch (err) {
            this.log("response post failed", { session: this.sessionId, err });
        }
    }
}
//# sourceMappingURL=sessionRunner.js.map