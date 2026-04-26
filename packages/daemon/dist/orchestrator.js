import { SessionRevokedError, UnauthorizedError } from "./client.js";
/**
 * Long-running loop that drives the daemon.
 *   heartbeat tick → POST /v1/heartbeat (api-key wide)
 *   poll tick      → GET /v1/poll → dispatch each session's messages into its ProfileRunner
 */
export class Orchestrator {
    deps;
    heartbeatTimer = null;
    pollTimer = null;
    log;
    setTimer;
    clearTimer;
    _status = "idle";
    stopping = false;
    shouldResumeInProgress = true;
    constructor(deps) {
        this.deps = deps;
        this.log = deps.log ?? (() => void 0);
        this.setTimer = deps.setTimer ?? setTimeout;
        this.clearTimer = deps.clearTimer ?? clearTimeout;
    }
    get status() {
        return this._status;
    }
    start() {
        if (this._status === "running")
            return;
        this._status = "running";
        this.scheduleHeartbeat(0);
        this.schedulePoll(0);
    }
    async stop() {
        this.stopping = true;
        this._status = "stopped";
        if (this.heartbeatTimer)
            this.clearTimer(this.heartbeatTimer);
        if (this.pollTimer)
            this.clearTimer(this.pollTimer);
        this.heartbeatTimer = null;
        this.pollTimer = null;
        try {
            await this.deps.client.heartbeat({ note: "shutdown" });
        }
        catch {
            // ignore
        }
        await this.deps.pool.stop();
    }
    /* ============ timers ============ */
    scheduleHeartbeat(delayMs) {
        if (this.stopping)
            return;
        this.heartbeatTimer = this.setTimer(() => void this.tickHeartbeat(), delayMs);
    }
    schedulePoll(delayMs) {
        if (this.stopping)
            return;
        this.pollTimer = this.setTimer(() => void this.tickPoll(), delayMs);
    }
    async tickHeartbeat() {
        if (this.stopping)
            return;
        try {
            await this.deps.client.heartbeat({ note: "running" });
        }
        catch (e) {
            this.handleFatal(e);
        }
        finally {
            this.scheduleHeartbeat(this.deps.config.heartbeatIntervalMs);
        }
    }
    async tickPoll() {
        if (this.stopping)
            return;
        try {
            const res = await this.deps.client.poll({
                resumeInProgress: this.shouldResumeInProgress
            });
            this.shouldResumeInProgress = false;
            for (const s of res.sessions) {
                if (!this.deps.pool.hasProfile(s.profileName)) {
                    this.log("poll returned unknown profile — skipping", {
                        profile: s.profileName,
                        sessionId: s.sessionId
                    });
                    continue;
                }
                for (const msg of s.messages) {
                    this.deps.pool.enqueue(s.profileName, {
                        sessionId: s.sessionId,
                        messageId: msg.id,
                        content: msg.content,
                        resumeLastSession: msg.resumeLastSession ?? true,
                        interrupt: msg.resumeLastSession === false
                    });
                }
            }
        }
        catch (e) {
            this.handleFatal(e);
        }
        finally {
            const jitter = Math.floor(Math.random() * (this.deps.config.pollJitterMs + 1));
            this.schedulePoll(this.deps.config.pollIntervalMs + jitter);
        }
    }
    handleFatal(e) {
        if (e instanceof SessionRevokedError) {
            this._status = "session_revoked";
            this.log("api key revoked — shutting down");
            this.stopping = true;
            if (this.heartbeatTimer)
                this.clearTimer(this.heartbeatTimer);
            if (this.pollTimer)
                this.clearTimer(this.pollTimer);
            this.heartbeatTimer = null;
            this.pollTimer = null;
            return;
        }
        if (e instanceof UnauthorizedError) {
            this._status = "unauthorized";
            this.log("unauthorized — check API key");
            this.stopping = true;
            if (this.heartbeatTimer)
                this.clearTimer(this.heartbeatTimer);
            if (this.pollTimer)
                this.clearTimer(this.pollTimer);
            this.heartbeatTimer = null;
            this.pollTimer = null;
            return;
        }
        this.log("transient error", e);
    }
}
//# sourceMappingURL=orchestrator.js.map