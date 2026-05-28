import { z } from "zod";
declare const configSchema: z.ZodObject<{
    telegramBotToken: z.ZodString;
    listenHost: z.ZodDefault<z.ZodString>;
    listenPort: z.ZodDefault<z.ZodNumber>;
    databaseUrl: z.ZodDefault<z.ZodString>;
    logLevel: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error", "fatal"]>>;
    publicUrl: z.ZodOptional<z.ZodString>;
    /** Max clock skew between daemons and bot when interpreting heartbeat age. */
    heartbeatStaleMs: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    telegramBotToken: string;
    listenHost: string;
    listenPort: number;
    databaseUrl: string;
    heartbeatStaleMs: number;
    publicUrl?: string | undefined;
}, {
    telegramBotToken: string;
    logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | undefined;
    listenHost?: string | undefined;
    listenPort?: number | undefined;
    databaseUrl?: string | undefined;
    publicUrl?: string | undefined;
    heartbeatStaleMs?: number | undefined;
}>;
export type BotConfig = z.infer<typeof configSchema>;
/** Parse a config object directly (useful in tests). */
export declare function parseConfig(input: Record<string, unknown>): BotConfig;
/** Load config from process.env — throws on missing required fields. */
export declare function loadConfigFromEnv(env?: NodeJS.ProcessEnv): BotConfig;
export {};
//# sourceMappingURL=config.d.ts.map