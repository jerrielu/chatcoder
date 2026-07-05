/** Maximum undelivered messages kept per (session). */
export const MAX_QUEUE_DEPTH = 10;

/** 1-second rate limit on chat instruction enqueues. */
export const CODE_RATE_LIMIT_MS = 1_000;

/** Max bytes for a single instruction (user → daemon). */
export const MAX_INSTRUCTION_BYTES = 4 * 1024;

/** Max bytes for a single response (daemon → user). */
export const MAX_RESPONSE_BYTES = 32 * 1024;

/** Max profile names a single daemon can register. */
export const MAX_PROFILES_PER_DAEMON = 32;

/** Max work dirs a single daemon can register. */
export const MAX_WORK_DIRS = 32;

/** Max length of a profile name. */
export const MAX_PROFILE_NAME_LENGTH = 64;

/** Current application version (semver). Keep in sync with root package.json. */
export const APP_VERSION = "0.3.0";

/** API path constants. Both bot and daemon import these. */
export const API_PATHS = {
  heartbeat: "/v1/heartbeat",
  poll: "/v1/poll",
  responses: "/v1/responses",
  daemonRegister: "/v1/daemon/register"
} as const;

/** Admin API path prefix (loopback-only, no auth). */
export const ADMIN_API_PREFIX = "/v1/admin";

/** Admin API path builders used by the bot server and the dashboard client. */
export const ADMIN_API_PATHS = {
  apiKeys: `${ADMIN_API_PREFIX}/api-keys`,
  apiKey: (id: string): string =>
    `${ADMIN_API_PREFIX}/api-keys/${encodeURIComponent(id)}`,
  apiKeyProfiles: (id: string): string =>
    `${ADMIN_API_PREFIX}/api-keys/${encodeURIComponent(id)}/profiles`,
  sessions: `${ADMIN_API_PREFIX}/sessions`,
  session: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}`,
  sessionDetail: (id: string): string =>
    `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/detail`,
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

/** Tool kinds supported by a profile. */
export const TOOL_KINDS = ["CLAUDE_CODE", "OPENAI", "REASONIX", "CUSTOM"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/** Codex reasoning effort levels supported by the Telegram bot menu. */
export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

/** Codex slash command used to request token totals. */
export const CODEX_TOKEN_USAGE_COMMAND = "/token";

/** Message kinds supported in the queue. */
export const MESSAGE_KINDS = ["instruction", "stop"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
