import { z } from "zod";
import { TOOL_KINDS } from "@chatcoder/shared";
export declare const ClaudeCodeConfig: z.ZodObject<{
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
export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfig>;
export declare const CodexConfig: z.ZodObject<{
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
export type CodexConfig = z.infer<typeof CodexConfig>;
export declare const CustomConfig: z.ZodObject<{
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
export type CustomConfig = z.infer<typeof CustomConfig>;
export declare const ClaudeCodeProfile: z.ZodObject<{
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
}>;
export type ClaudeCodeProfile = z.infer<typeof ClaudeCodeProfile>;
export declare const OpenAIProfile: z.ZodObject<{
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
}>;
export type OpenAIProfile = z.infer<typeof OpenAIProfile>;
export declare const CustomProfile: z.ZodObject<{
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
}>;
export type CustomProfile = z.infer<typeof CustomProfile>;
export declare const Profile: z.ZodDiscriminatedUnion<"tool", [z.ZodObject<{
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
}>]>;
export type Profile = z.infer<typeof Profile>;
export { TOOL_KINDS };
//# sourceMappingURL=profile.d.ts.map