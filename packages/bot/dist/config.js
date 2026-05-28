import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
const configSchema = z.object({
    telegramBotToken: z.string().min(1),
    listenHost: z.string().default("0.0.0.0"),
    listenPort: z.number().int().min(1).max(65535).default(8080),
    databaseUrl: z.string().min(1).default(() => `sqlite:${path.join(os.homedir(), ".chatcoder", "chatcoder.db")}`),
    logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
    publicUrl: z.string().url().optional(),
    /** Max clock skew between daemons and bot when interpreting heartbeat age. */
    heartbeatStaleMs: z.number().int().positive().default(60_000)
});
/** Parse a config object directly (useful in tests). */
export function parseConfig(input) {
    return configSchema.parse(input);
}
/** Load config from process.env — throws on missing required fields. */
export function loadConfigFromEnv(env = process.env) {
    const raw = {
        telegramBotToken: env.TELEGRAM_BOT_TOKEN,
        listenHost: env.BOT_LISTEN_HOST,
        listenPort: env.BOT_LISTEN_PORT ? Number(env.BOT_LISTEN_PORT) : undefined,
        databaseUrl: env.DATABASE_URL,
        logLevel: env.BOT_LOG_LEVEL,
        publicUrl: env.BOT_PUBLIC_URL,
        heartbeatStaleMs: env.BOT_HEARTBEAT_STALE_MS ? Number(env.BOT_HEARTBEAT_STALE_MS) : undefined
    };
    // Strip undefined so defaults apply.
    for (const k of Object.keys(raw))
        if (raw[k] === undefined)
            delete raw[k];
    return parseConfig(raw);
}
//# sourceMappingURL=config.js.map