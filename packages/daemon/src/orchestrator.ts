import { SessionRevokedError, UnauthorizedError } from "./client.js";
import type { ApiClient } from "./client.js";
import type { SessionManager } from "./sessionManager.js";
import type { DaemonConfig } from "./config.js";

export interface OrchestratorDeps {
  config: DaemonConfig;
  client: ApiClient;
  sessionManager: SessionManager;
  log?: (msg: string, extra?: unknown) => void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export type OrchestratorStatus =
  | "idle"
  | "running"
  | "session_revoked"
  | "unauthorized"
  | "stopped";

/**
 * Long-running loop that drives the daemon.
 *   heartbeat tick → POST /v1/heartbeat (api-key wide)
 *   poll tick      → GET /v1/poll → dispatch each session's messages into its SessionRunner
 */
export class Orchestrator {
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly log: (m: string, extra?: unknown) => void;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private _status: OrchestratorStatus = "idle";
  private stopping = false;
  private shouldResumeInProgress = true;
  private lastReRegisterAt = 0;

  constructor(private readonly deps: OrchestratorDeps) {
    this.log = deps.log ?? (() => void 0);
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
  }

  get status(): OrchestratorStatus {
    return this._status;
  }

  start(): void {
    if (this._status === "running") return;
    this._status = "running";
    this.scheduleHeartbeat(0);
    this.schedulePoll(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this._status = "stopped";
    if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
    if (this.pollTimer) this.clearTimer(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
    try {
      await this.deps.client.heartbeat({ note: "shutdown" });
    } catch {
      // ignore
    }
    await this.deps.sessionManager.stop();
  }

  /* ============ timers ============ */

  private scheduleHeartbeat(delayMs: number): void {
    if (this.stopping) return;
    this.heartbeatTimer = this.setTimer(() => void this.tickHeartbeat(), delayMs);
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopping) return;
    this.pollTimer = this.setTimer(() => void this.tickPoll(), delayMs);
  }

  private async tickHeartbeat(): Promise<void> {
    if (this.stopping) return;
    try {
      const body: { note: string; profiles?: unknown[]; workDirs?: string[] } = { note: "running" };
      const now = Date.now();
      const profiles = now - this.lastReRegisterAt >= this.deps.config.reRegisterIntervalMs
        ? this.deps.config.profiles.map((p) => ({
            name: p.name,
            tool: p.tool as "CLAUDE_CODE" | "OPENAI" | "REASONIX" | "CUSTOM",
            ...(p.metadata !== undefined ? { metadata: p.metadata } : {})
          }))
        : undefined;
      const workDirs = profiles && this.deps.config.workDirs.length > 0
        ? this.deps.config.workDirs
        : undefined;
      if (profiles) this.lastReRegisterAt = now;
      await this.deps.client.heartbeat({ note: "running", profiles, workDirs });
    } catch (e) {
      this.handleFatal(e);
    } finally {
      this.scheduleHeartbeat(this.deps.config.heartbeatIntervalMs);
    }
  }

  private async tickPoll(): Promise<void> {
    if (this.stopping) return;
    try {
      const res = await this.deps.client.poll({
        resumeInProgress: this.shouldResumeInProgress
      });
      this.shouldResumeInProgress = false;
      for (const s of res.sessions) {
        const profile = this.deps.config.profiles.find((p) => p.name === s.profileName);
        if (!profile) {
          this.log("poll returned unknown profile — skipping", {
            profile: s.profileName,
            sessionId: s.sessionId
          });
          continue;
        }
        for (const msg of s.messages) {
          this.deps.sessionManager.enqueue(s.sessionId, profile, {
            sessionId: s.sessionId,
            messageId: msg.id,
            kind: msg.kind,
            content: msg.content,
            resumeLastSession: msg.resumeLastSession ?? true,
            codexReasoningEffort: msg.codexReasoningEffort,
            workDir: s.workDir
          });
        }
      }
    } catch (e) {
      this.handleFatal(e);
    } finally {
      const jitter = Math.floor(Math.random() * (this.deps.config.pollJitterMs + 1));
      this.schedulePoll(this.deps.config.pollIntervalMs + jitter);
    }
  }

  private handleFatal(e: unknown): void {
    if (e instanceof SessionRevokedError) {
      this._status = "session_revoked";
      this.log("api key revoked — shutting down");
      this.stopping = true;
      if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
      if (this.pollTimer) this.clearTimer(this.pollTimer);
      this.heartbeatTimer = null;
      this.pollTimer = null;
      return;
    }
    if (e instanceof UnauthorizedError) {
      this._status = "unauthorized";
      this.log("unauthorized — check API key");
      this.stopping = true;
      if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
      if (this.pollTimer) this.clearTimer(this.pollTimer);
      this.heartbeatTimer = null;
      this.pollTimer = null;
      return;
    }
    this.log("transient error", e);
  }
}
