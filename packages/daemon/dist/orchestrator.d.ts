import type { ApiClient } from "./client.js";
import type { ProfilePool } from "./profilePool.js";
import type { DaemonConfig } from "./config.js";
export interface OrchestratorDeps {
    config: DaemonConfig;
    client: ApiClient;
    pool: ProfilePool;
    log?: (msg: string, extra?: unknown) => void;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
}
export type OrchestratorStatus = "idle" | "running" | "session_revoked" | "unauthorized" | "stopped";
/**
 * Long-running loop that drives the daemon.
 *   heartbeat tick → POST /v1/heartbeat (api-key wide)
 *   poll tick      → GET /v1/poll → dispatch each session's messages into its ProfileRunner
 */
export declare class Orchestrator {
    private readonly deps;
    private heartbeatTimer;
    private pollTimer;
    private readonly log;
    private readonly setTimer;
    private readonly clearTimer;
    private _status;
    private stopping;
    private shouldResumeInProgress;
    private lastReRegisterAt;
    constructor(deps: OrchestratorDeps);
    get status(): OrchestratorStatus;
    start(): void;
    stop(): Promise<void>;
    private scheduleHeartbeat;
    private schedulePoll;
    private tickHeartbeat;
    private tickPoll;
    private handleFatal;
}
//# sourceMappingURL=orchestrator.d.ts.map