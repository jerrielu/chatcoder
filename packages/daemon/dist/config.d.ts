import { z } from "zod";
export declare const DaemonConfig: z.ZodObject<{
    apiUrl: z.ZodString;
    apiKey: z.ZodString;
    pollIntervalMs: z.ZodDefault<z.ZodNumber>;
    pollJitterMs: z.ZodDefault<z.ZodNumber>;
    heartbeatIntervalMs: z.ZodDefault<z.ZodNumber>;
    idleShutdownMs: z.ZodDefault<z.ZodNumber>;
    /** Global in-flight cap across profiles. */
    maxConcurrency: z.ZodDefault<z.ZodNumber>;
    profiles: z.ZodArray<z.ZodDiscriminatedUnion<"tool", [z.ZodObject<{
        tool: z.ZodLiteral<"CLAUDE_CODE">;
        claudeCode: z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            baseUrl: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            skipPermissions: z.ZodDefault<z.ZodBoolean>;
            outputFormat: z.ZodDefault<z.ZodEnum<["text", "stream-json"]>>;
            extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            skipPermissions: boolean;
            outputFormat: "text" | "stream-json";
            extraArgs: string[];
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
        }, {
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            skipPermissions?: boolean | undefined;
            outputFormat?: "text" | "stream-json" | undefined;
            extraArgs?: string[] | undefined;
        }>;
        name: z.ZodString;
        cwd: z.ZodString;
        metadata: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        tool: "CLAUDE_CODE";
        claudeCode: {
            skipPermissions: boolean;
            outputFormat: "text" | "stream-json";
            extraArgs: string[];
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    }, {
        tool: "CLAUDE_CODE";
        claudeCode: {
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            skipPermissions?: boolean | undefined;
            outputFormat?: "text" | "stream-json" | undefined;
            extraArgs?: string[] | undefined;
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    }>, z.ZodObject<{
        tool: z.ZodLiteral<"OPENAI">;
        codex: z.ZodObject<{
            apiKey: z.ZodOptional<z.ZodString>;
            baseUrl: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            sandboxMode: z.ZodOptional<z.ZodEnum<["read-only", "workspace-write", "danger-full-access"]>>;
            approvalMode: z.ZodOptional<z.ZodEnum<["never", "on-request", "on-failure", "untrusted"]>>;
            fullAuto: z.ZodDefault<z.ZodBoolean>;
            bypassApprovalsAndSandbox: z.ZodDefault<z.ZodBoolean>;
            extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            extraArgs: string[];
            fullAuto: boolean;
            bypassApprovalsAndSandbox: boolean;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
            approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
        }, {
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            extraArgs?: string[] | undefined;
            sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
            approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
            fullAuto?: boolean | undefined;
            bypassApprovalsAndSandbox?: boolean | undefined;
        }>;
        name: z.ZodString;
        cwd: z.ZodString;
        metadata: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        tool: "OPENAI";
        name: string;
        cwd: string;
        codex: {
            extraArgs: string[];
            fullAuto: boolean;
            bypassApprovalsAndSandbox: boolean;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
            approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
        };
        metadata?: string | undefined;
    }, {
        tool: "OPENAI";
        name: string;
        cwd: string;
        codex: {
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            extraArgs?: string[] | undefined;
            sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
            approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
            fullAuto?: boolean | undefined;
            bypassApprovalsAndSandbox?: boolean | undefined;
        };
        metadata?: string | undefined;
    }>, z.ZodObject<{
        tool: z.ZodLiteral<"CUSTOM">;
        custom: z.ZodObject<{
            launchBin: z.ZodString;
            args: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
            env: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
            messagePlacement: z.ZodDefault<z.ZodEnum<["appended", "stdin", "placeholder"]>>;
        }, "strip", z.ZodTypeAny, {
            launchBin: string;
            args: string[];
            env: Record<string, string>;
            messagePlacement: "appended" | "stdin" | "placeholder";
        }, {
            launchBin: string;
            args?: string[] | undefined;
            env?: Record<string, string> | undefined;
            messagePlacement?: "appended" | "stdin" | "placeholder" | undefined;
        }>;
        name: z.ZodString;
        cwd: z.ZodString;
        metadata: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        tool: "CUSTOM";
        custom: {
            launchBin: string;
            args: string[];
            env: Record<string, string>;
            messagePlacement: "appended" | "stdin" | "placeholder";
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    }, {
        tool: "CUSTOM";
        custom: {
            launchBin: string;
            args?: string[] | undefined;
            env?: Record<string, string> | undefined;
            messagePlacement?: "appended" | "stdin" | "placeholder" | undefined;
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    apiKey: string;
    apiUrl: string;
    pollIntervalMs: number;
    pollJitterMs: number;
    heartbeatIntervalMs: number;
    idleShutdownMs: number;
    maxConcurrency: number;
    profiles: ({
        tool: "CLAUDE_CODE";
        claudeCode: {
            skipPermissions: boolean;
            outputFormat: "text" | "stream-json";
            extraArgs: string[];
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    } | {
        tool: "OPENAI";
        name: string;
        cwd: string;
        codex: {
            extraArgs: string[];
            fullAuto: boolean;
            bypassApprovalsAndSandbox: boolean;
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
            approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
        };
        metadata?: string | undefined;
    } | {
        tool: "CUSTOM";
        custom: {
            launchBin: string;
            args: string[];
            env: Record<string, string>;
            messagePlacement: "appended" | "stdin" | "placeholder";
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    })[];
}, {
    apiKey: string;
    apiUrl: string;
    profiles: ({
        tool: "CLAUDE_CODE";
        claudeCode: {
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            skipPermissions?: boolean | undefined;
            outputFormat?: "text" | "stream-json" | undefined;
            extraArgs?: string[] | undefined;
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    } | {
        tool: "OPENAI";
        name: string;
        cwd: string;
        codex: {
            apiKey?: string | undefined;
            baseUrl?: string | undefined;
            model?: string | undefined;
            extraArgs?: string[] | undefined;
            sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
            approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
            fullAuto?: boolean | undefined;
            bypassApprovalsAndSandbox?: boolean | undefined;
        };
        metadata?: string | undefined;
    } | {
        tool: "CUSTOM";
        custom: {
            launchBin: string;
            args?: string[] | undefined;
            env?: Record<string, string> | undefined;
            messagePlacement?: "appended" | "stdin" | "placeholder" | undefined;
        };
        name: string;
        cwd: string;
        metadata?: string | undefined;
    })[];
    pollIntervalMs?: number | undefined;
    pollJitterMs?: number | undefined;
    heartbeatIntervalMs?: number | undefined;
    idleShutdownMs?: number | undefined;
    maxConcurrency?: number | undefined;
}>;
export type DaemonConfig = z.infer<typeof DaemonConfig>;
export declare function defaultConfigPath(): string;
export declare function loadConfig(p?: string): DaemonConfig;
export declare function writeConfig(cfg: DaemonConfig, p?: string): void;
//# sourceMappingURL=config.d.ts.map