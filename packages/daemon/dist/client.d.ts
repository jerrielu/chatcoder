import { DaemonRegisterResponse, PollResponse, type DaemonRegisterBody, type HeartbeatBody, type HeartbeatResponse, type PostResponseBody } from "@chatcoder/shared";
export declare class SessionRevokedError extends Error {
    constructor();
}
export declare class UnauthorizedError extends Error {
    constructor();
}
export interface ApiClientOptions {
    apiUrl: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    /** Max retry attempts on transient (5xx / network) errors. */
    retries?: number;
    /** Base backoff between retries in ms (exponential). */
    backoffMs?: number;
}
export declare class ApiClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly retries;
    private readonly backoffMs;
    constructor(opts: ApiClientOptions);
    register(body: DaemonRegisterBody): Promise<DaemonRegisterResponse>;
    heartbeat(body?: HeartbeatBody): Promise<HeartbeatResponse>;
    poll(opts?: {
        resumeInProgress?: boolean;
    }): Promise<PollResponse>;
    postResponse(body: PostResponseBody): Promise<{
        ok: true;
    }>;
    private request;
}
/** Non-retryable client-side (4xx) error returned by the API. */
export declare class ApiClientError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
//# sourceMappingURL=client.d.ts.map