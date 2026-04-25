import {
  API_PATHS,
  DaemonRegisterResponse,
  ERROR_CODES,
  PollResponse,
  type ApiErrorEnvelope,
  type DaemonRegisterBody,
  type HeartbeatBody,
  type HeartbeatResponse,
  type PostResponseBody
} from "@chatcoder/shared";

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

export interface ApiClientOptions {
  apiUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Max retry attempts on transient (5xx / network) errors. */
  retries?: number;
  /** Base backoff between retries in ms (exponential). */
  backoffMs?: number;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly backoffMs: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.apiUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retries = opts.retries ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
  }

  async register(body: DaemonRegisterBody): Promise<DaemonRegisterResponse> {
    const res = await this.request<unknown>("POST", API_PATHS.daemonRegister, body);
    return DaemonRegisterResponse.parse(res);
  }

  async heartbeat(body: HeartbeatBody = {}): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>("POST", API_PATHS.heartbeat, body);
  }

  async poll(opts: { resumeInProgress?: boolean } = {}): Promise<PollResponse> {
    const path = opts.resumeInProgress
      ? `${API_PATHS.poll}?resumeInProgress=1`
      : API_PATHS.poll;
    const res = await this.request<unknown>("GET", path);
    return PollResponse.parse(res);
  }

  async postResponse(body: PostResponseBody): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", API_PATHS.responses, body);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = this.baseUrl + path;
    let lastErr: unknown;
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
        if (res.status === 401) throw new UnauthorizedError();
        if (res.status === 410) throw new SessionRevokedError();
        if (res.status >= 500) {
          lastErr = new Error(`server ${res.status}`);
        } else if (!res.ok) {
          const envelope = (await res.json().catch(() => null)) as ApiErrorEnvelope | null;
          const msg = envelope?.error?.message ?? `HTTP ${res.status}`;
          const code = envelope?.error?.code ?? ERROR_CODES.INTERNAL;
          throw new ApiClientError(code, `${code}: ${msg}`);
        } else {
          return (await res.json()) as T;
        }
      } catch (e) {
        if (
          e instanceof UnauthorizedError ||
          e instanceof SessionRevokedError ||
          e instanceof ApiClientError
        ) {
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
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
