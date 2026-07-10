import { stripAnsi } from "./ansi.js";
import { extractResponseFromJSON } from "./summary.js";
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
 * Per-profile FIFO runner. Instructions for the same profile are executed in
 * arrival order (serial), which matches the "don't race on the same cwd"
 * invariant. Different ProfileRunner instances run in parallel, bounded by
 * the global concurrency semaphore in ProfilePool.
 */
export class ProfileRunner {
    deps;
    queue = [];
    running = false;
    stopping = false;
    currentAbort = null;
    activeTaskId = null;
    supersededTaskIds = new Set();
    log;
    setTimer;
    clearTimer;
    updateMs;
    chunkMax;
    idlePromise = Promise.resolve();
    idleResolve = null;
    constructor(deps) {
        this.deps = deps;
        this.log = deps.log ?? (() => void 0);
        this.setTimer = deps.setTimer ?? setTimeout;
        this.clearTimer = deps.clearTimer ?? clearTimeout;
        this.updateMs = deps.responseUpdateIntervalMs ?? DEFAULT_RESPONSE_UPDATE_INTERVAL_MS;
        this.chunkMax = deps.responseChunkMaxChars ?? DEFAULT_RESPONSE_CHUNK_MAX_CHARS;
    }
    get profileName() {
        return this.deps.profile.name;
    }
    get pending() {
        return this.queue.length + (this.running ? 1 : 0);
    }
    enqueue(task) {
        if (this.stopping)
            return;
        if (task.interrupt) {
            for (const queued of this.queue) {
                this.supersededTaskIds.add(queued.messageId);
            }
            if (this.activeTaskId) {
                this.supersededTaskIds.add(this.activeTaskId);
            }
            this.queue.splice(0, this.queue.length, task);
            this.currentAbort?.abort();
        }
        else {
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
    async whenIdle() {
        return this.idlePromise;
    }
    async stop() {
        this.stopping = true;
        await this.idlePromise;
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
            if (this.supersededTaskIds.delete(task.messageId))
                return;
            this.log("<<< instruction", { profile: this.profileName, session: task.sessionId, content: task.content });
            const abort = new AbortController();
            this.currentAbort = abort;
            try {
                await this.executeWithOutputUpdates(task, abort.signal);
            }
            catch (err) {
                if (abort.signal.aborted)
                    return;
                this.log("execution failed", { profile: this.profileName, err });
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
            this.supersededTaskIds.delete(task.messageId);
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
                this.log("progress response failed", { profile: this.profileName, session: task.sessionId, err });
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
            // Try to extract a JSON response, or fall back to the raw output
            const responseText = extractResponseFromJSON(rawText);
            const finalContent = responseText ?? rawText;
            const formatted = convert(finalContent).trim();
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
            this.log(">>> response", { profile: this.profileName, session: sessionId, chunk: outboundText });
            await this.deps.postResponse(sessionId, outboundText, opts);
            return;
        }
        for (let i = 0; i < outboundText.length; i += this.chunkMax) {
            const chunk = outboundText.slice(i, i + this.chunkMax);
            this.log(">>> response", { profile: this.profileName, session: sessionId, chunk });
            await this.deps.postResponse(sessionId, chunk, opts);
        }
    }
    async tryPostChunked(sessionId, text, opts = {}) {
        try {
            await this.postChunked(sessionId, text, opts);
        }
        catch (err) {
            this.log("response post failed", { profile: this.profileName, session: sessionId, err });
        }
    }
}
//# sourceMappingURL=profileRunner.js.map