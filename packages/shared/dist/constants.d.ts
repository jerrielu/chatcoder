/** Maximum undelivered messages kept per (session). */
export declare const MAX_QUEUE_DEPTH = 10;
/** 1-second rate limit on chat instruction enqueues. */
export declare const CODE_RATE_LIMIT_MS = 1000;
/** Max bytes for a single instruction (user → daemon). */
export declare const MAX_INSTRUCTION_BYTES: number;
/** Max bytes for a single response (daemon → user). */
export declare const MAX_RESPONSE_BYTES: number;
/** Max profile names a single daemon can register. */
export declare const MAX_PROFILES_PER_DAEMON = 32;
/** Max work dirs a single daemon can register. */
export declare const MAX_WORK_DIRS = 32;
/** Max length of a profile name. */
export declare const MAX_PROFILE_NAME_LENGTH = 64;
/** Current application version (semver). Keep in sync with root package.json. */
export declare const APP_VERSION = "0.1.0";
/** API path constants. Both bot and daemon import these. */
export declare const API_PATHS: {
    readonly heartbeat: "/v1/heartbeat";
    readonly poll: "/v1/poll";
    readonly responses: "/v1/responses";
    readonly daemonRegister: "/v1/daemon/register";
};
/** Admin API path prefix (loopback-only, no auth). */
export declare const ADMIN_API_PREFIX = "/v1/admin";
/** Admin API path builders used by the bot server and the dashboard client. */
export declare const ADMIN_API_PATHS: {
    readonly apiKeys: "/v1/admin/api-keys";
    readonly apiKey: (id: string) => string;
    readonly apiKeyProfiles: (id: string) => string;
    readonly sessions: "/v1/admin/sessions";
    readonly session: (id: string) => string;
    readonly sessionDetail: (id: string) => string;
    readonly revoke: (id: string) => string;
    readonly purge: (id: string) => string;
    readonly messages: (id: string) => string;
    readonly message: (id: string) => string;
};
/** API key prefix so operators can eyeball keys. */
export declare const API_KEY_PREFIX = "cc_";
/** Raw random bytes used to generate an API key (before base64url + prefix). */
export declare const API_KEY_RAND_BYTES = 36;
/** Minimum length for a user-supplied API key. */
export declare const MIN_API_KEY_LENGTH = 16;
/** Tool kinds supported by a profile. */
export declare const TOOL_KINDS: readonly ["CLAUDE_CODE", "OPENAI", "REASONIX", "CUSTOM"];
export type ToolKind = (typeof TOOL_KINDS)[number];
/** Codex reasoning effort levels supported by the Telegram bot menu. */
export declare const CODEX_REASONING_EFFORTS: readonly ["low", "medium", "high", "xhigh"];
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];
/** Codex slash command used to request token totals. */
export declare const CODEX_TOKEN_USAGE_COMMAND = "/token";
/** Message kinds supported in the queue. */
export declare const MESSAGE_KINDS: readonly ["instruction", "stop"];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
//# sourceMappingURL=constants.d.ts.map