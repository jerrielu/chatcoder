import { API_PATHS, DaemonRegisterResponse, ERROR_CODES, PollResponse } from "@chatcoder/shared";
export class SessionRevokedError extends Error {
    constructor() {
        super("session revoked");
        this.name = "SessionRevokedError";
    }
}
export class UnauthorizedError extends Error {
    constructor() {
        super("unauthorized");
        this.name = "UnauthorizedError";
    }
}
export class ApiClient {
    baseUrl;
    apiKey;
    fetchImpl;
    retries;
    backoffMs;
    constructor(opts) {
        this.baseUrl = opts.apiUrl.replace(/\/$/, "");
        this.apiKey = opts.apiKey;
        this.fetchImpl = opts.fetchImpl ?? fetch;
        this.retries = opts.retries ?? 3;
        this.backoffMs = opts.backoffMs ?? 500;
    }
    async register(body) {
        const res = await this.request("POST", API_PATHS.daemonRegister, body);
        return DaemonRegisterResponse.parse(res);
    }
    async heartbeat(body = {}) {
        return this.request("POST", API_PATHS.heartbeat, body);
    }
    async poll(opts = {}) {
        const path = opts.resumeInProgress
            ? `${API_PATHS.poll}?resumeInProgress=1`
            : API_PATHS.poll;
        const res = await this.request("GET", path);
        return PollResponse.parse(res);
    }
    async postResponse(body) {
        return this.request("POST", API_PATHS.responses, body);
    }
    async request(method, path, body) {
        const url = this.baseUrl + path;
        let lastErr;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            try {
                const res = await this.fetchImpl(url, {
                    method,
                    headers: {
                        authorization: `Bearer ${this.apiKey}`,
                        "content-type": "application/json",
                        accept: "application/json"
                    },
                    body: body === undefined ? undefined : JSON.stringify(body)
                });
                if (res.status === 401)
                    throw new UnauthorizedError();
                if (res.status === 410)
                    throw new SessionRevokedError();
                if (res.status >= 500) {
                    lastErr = new Error(`server ${res.status}`);
                }
                else if (!res.ok) {
                    const envelope = (await res.json().catch(() => null));
                    const msg = envelope?.error?.message ?? `HTTP ${res.status}`;
                    const code = envelope?.error?.code ?? ERROR_CODES.INTERNAL;
                    throw new ApiClientError(code, `${code}: ${msg}`);
                }
                else {
                    return (await res.json());
                }
            }
            catch (e) {
                if (e instanceof UnauthorizedError ||
                    e instanceof SessionRevokedError ||
                    e instanceof ApiClientError) {
                    throw e;
                }
                lastErr = e;
            }
            if (attempt < this.retries) {
                await delay(this.backoffMs * 2 ** attempt);
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error("request failed");
    }
}
/** Non-retryable client-side (4xx) error returned by the API. */
export class ApiClientError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ApiClientError";
    }
}
function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=client.js.map