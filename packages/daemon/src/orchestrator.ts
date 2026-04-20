import { SessionRevokedError, UnauthorizedError } from "./client.js";
import type { ApiClient } from "./client.js";
import { ToolExecutor } from "./toolExecutor.js";
import type { DaemonConfig } from "./config.js";

export interface OrchestratorDeps {
  config: DaemonConfig;
  client: ApiClient;
  tool: ToolExecutor;
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
 * Long-running loop that ties the API client and tool execution together.
 *   heartbeat tick (interval)        → POST /v1/heartbeat
 *   poll tick       (interval+jitter) → GET /v1/poll → execute tool command
 *   tool response                    → POST /v1/responses
 */
export class Orchestrator {
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly tool: ToolExecutor;
  private readonly log: (m: string, extra?: unknown) => void;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private _status: OrchestratorStatus = "idle";
  private stopping = false;
  private inflightResponses = 0;

  constructor(private readonly deps: OrchestratorDeps) {
    this.log = deps.log ?? (() => void 0);
    this.setTimer = deps.setTimer ?? setTimeout;
    this.clearTimer = deps.clearTimer ?? clearTimeout;
    this.tool = deps.tool;
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
    // Best-effort last heartbeat so the bot knows we went away.
    try {
      await this.deps.client.heartbeat({ note: "shutdown" });
    } catch {
      // ignore
    }
    // Let any in-flight responses finish.
    const deadline = Date.now() + 5_000;
    while (this.inflightResponses > 0 && Date.now() < deadline) {
      await new Promise((r) => this.setTimer(() => r(undefined), 50));
    }
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
      await this.deps.client.heartbeat({ note: "running" });
    } catch (e) {
      this.handleFatal(e);
    } finally {
      this.scheduleHeartbeat(this.deps.config.heartbeatIntervalMs);
    }
  }

  private async tickPoll(): Promise<void> {
    if (this.stopping) return;
    try {
      const res = await this.deps.client.poll();
      if (res.reset) {
        this.log("session reset — no action needed for tool executor");
      }
      for (const msg of res.messages) {
        this.log("<<< instruction", msg.content);
        try {
          const output = await this.tool.execute(msg.content);
          await this.onToolResponse(output);
        } catch (err) {
          this.log("tool execution failed", err);
          await this.onToolResponse(`Error: ${err instanceof Error ? err.message : String(err)}`);
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
      this.log("session revoked — shutting down");
      this.stopping = true;
      if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
      if (this.pollTimer) this.clearTimer(this.pollTimer);
      this.heartbeatTimer = null;
      this.pollTimer = null;
      return;
    }
    if (e instanceof UnauthorizedError) {
      this._status = "unauthorized";
      this.log(`unauthorized — check API key: ${this.deps.config.apiKey}`);
      this.stopping = true;
      if (this.heartbeatTimer) this.clearTimer(this.heartbeatTimer);
      if (this.pollTimer) this.clearTimer(this.pollTimer);
      this.heartbeatTimer = null;
      this.pollTimer = null;
      return;
    }
    this.log("transient error", e);
  }

  private async onToolResponse(text: string): Promise<void> {
    this.log(">>> response", text);
    this.inflightResponses++;
    try {
      await this.deps.client.postResponse({ content: text });
    } catch (e) {
      this.handleFatal(e);
    } finally {
      this.inflightResponses--;
    }
  }
}
