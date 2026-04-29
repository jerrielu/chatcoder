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
/** Max length of a profile name. */
export const MAX_PROFILE_NAME_LENGTH = 64;
/** API path constants. Both bot and daemon import these. */
export const API_PATHS = {
    heartbeat: "/v1/heartbeat",
    poll: "/v1/poll",
    responses: "/v1/responses",
    daemonRegister: "/v1/daemon/register"
};
/** Admin API path prefix (loopback-only, no auth). */
export const ADMIN_API_PREFIX = "/v1/admin";
/** Admin API path builders used by the bot server and the dashboard client. */
export const ADMIN_API_PATHS = {
    apiKeys: `${ADMIN_API_PREFIX}/api-keys`,
    apiKey: (id) => `${ADMIN_API_PREFIX}/api-keys/${encodeURIComponent(id)}`,
    apiKeyProfiles: (id) => `${ADMIN_API_PREFIX}/api-keys/${encodeURIComponent(id)}/profiles`,
    sessions: `${ADMIN_API_PREFIX}/sessions`,
    session: (id) => `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}`,
    sessionDetail: (id) => `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/detail`,
    revoke: (id) => `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/revoke`,
    purge: (id) => `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/purge`,
    messages: (id) => `${ADMIN_API_PREFIX}/sessions/${encodeURIComponent(id)}/messages`,
    message: (id) => `${ADMIN_API_PREFIX}/messages/${encodeURIComponent(id)}`
};
/** API key prefix so operators can eyeball keys. */
export const API_KEY_PREFIX = "cc_";
/** Raw random bytes used to generate an API key (before base64url + prefix). */
export const API_KEY_RAND_BYTES = 36;
/** Minimum length for a user-supplied API key. */
export const MIN_API_KEY_LENGTH = 16;
/** Tool kinds supported by a profile. */
export const TOOL_KINDS = ["CLAUDE_CODE", "OPENAI", "CUSTOM"];
/** Codex reasoning effort levels supported by the Telegram bot menu. */
export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"];
/** Codex slash command used to request token totals. */
export const CODEX_TOKEN_USAGE_COMMAND = "/token";
//# sourceMappingURL=constants.js.map