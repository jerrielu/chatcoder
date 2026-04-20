/** Maximum undelivered messages kept per (session, direction). */
export const MAX_QUEUE_DEPTH = 10;

/** 1-second rate limit on /code instructions. */
export const CODE_RATE_LIMIT_MS = 1_000;

/** Max bytes for a single instruction (user → daemon). */
export const MAX_INSTRUCTION_BYTES = 4 * 1024;

/** Max bytes for a single response (daemon → user). */
export const MAX_RESPONSE_BYTES = 32 * 1024;

/** API path constants. Both bot and daemon import these. */
export const API_PATHS = {
  heartbeat: "/v1/heartbeat",
  poll: "/v1/poll",
  responses: "/v1/responses",
  session: "/v1/session"
} as const;

/** Admin API path prefix (loopback-only, no auth). */
export const ADMIN_API_PREFIX = "/v1/admin";

/** Admin API path builders used by the bot server and the dashboard client. */
export const ADMIN_API_PATHS = {
  sessions: `${ADMIN_API_PREFIX}/sessions`,
  session: (id: string): string => `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}`,
  sessionDetail: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/detail`,
  rotate: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/rotate`,
  revoke: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/revoke`,
  purge: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/purge`,
  messages: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/messages`,
  message: (id: string): string =>
    `${ADMIN_API_PREFIX}/messages/${encodeURIComponent(id)}`
} as const;

/** API key prefix so operators can eyeball keys. */
export const API_KEY_PREFIX = "cc_";

/** Raw random bytes used to generate an API key (before base64url + prefix). */
export const API_KEY_RAND_BYTES = 36;

/** Minimum length for a user-supplied API key. */
export const MIN_API_KEY_LENGTH = 16;
