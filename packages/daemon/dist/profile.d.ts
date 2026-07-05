import { z } from "zod";
import { TOOL_KINDS } from "@chatcoder/shared";
export declare const ClaudeCodeConfig: z.ZodObject<{
    baseUrl: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    authToken: z.ZodOptional<z.ZodString>;
    defaultOpusModel: z.ZodOptional<z.ZodString>;
    defaultSonnetModel: z.ZodOptional<z.ZodString>;
    defaultHaikuModel: z.ZodOptional<z.ZodString>;
    disableNonessentialTraffic: z.ZodDefault<z.ZodBoolean>;
    effortLevel: z.ZodOptional<z.ZodString>;
    skipPermissions: z.ZodDefault<z.ZodBoolean>;
    outputFormat: z.ZodDefault<z.ZodEnum<["text", "stream-json"]>>;
    extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    disableNonessentialTraffic: boolean;
    skipPermissions: boolean;
    outputFormat: "text" | "stream-json";
    extraArgs: string[];
    baseUrl?: string | undefined;
    model?: string | undefined;
    authToken?: string | undefined;
    defaultOpusModel?: string | undefined;
    defaultSonnetModel?: string | undefined;
    defaultHaikuModel?: string | undefined;
    effortLevel?: string | undefined;
}, {
    baseUrl?: string | undefined;
    model?: string | undefined;
    authToken?: string | undefined;
    defaultOpusModel?: string | undefined;
    defaultSonnetModel?: string | undefined;
    defaultHaikuModel?: string | undefined;
    disableNonessentialTraffic?: boolean | undefined;
    effortLevel?: string | undefined;
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
    baseUrl?: string | undefined;
    model?: string | undefined;
    apiKey?: string | undefined;
    sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
    approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
}, {
    baseUrl?: string | undefined;
    model?: string | undefined;
    extraArgs?: string[] | undefined;
    apiKey?: string | undefined;
    sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
    approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
    fullAuto?: boolean | undefined;
    bypassApprovalsAndSandbox?: boolean | undefined;
}>;
export type CodexConfig = z.infer<typeof CodexConfig>;
export declare const ReasonixConfig: z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    extraArgs: string[];
    model?: string | undefined;
}, {
    model?: string | undefined;
    extraArgs?: string[] | undefined;
}>;
export type ReasonixConfig = z.infer<typeof ReasonixConfig>;
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
        baseUrl: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        authToken: z.ZodOptional<z.ZodString>;
        defaultOpusModel: z.ZodOptional<z.ZodString>;
        defaultSonnetModel: z.ZodOptional<z.ZodString>;
        defaultHaikuModel: z.ZodOptional<z.ZodString>;
        disableNonessentialTraffic: z.ZodDefault<z.ZodBoolean>;
        effortLevel: z.ZodOptional<z.ZodString>;
        skipPermissions: z.ZodDefault<z.ZodBoolean>;
        outputFormat: z.ZodDefault<z.ZodEnum<["text", "stream-json"]>>;
        extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        disableNonessentialTraffic: boolean;
        skipPermissions: boolean;
        outputFormat: "text" | "stream-json";
        extraArgs: string[];
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        effortLevel?: string | undefined;
    }, {
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        disableNonessentialTraffic?: boolean | undefined;
        effortLevel?: string | undefined;
        skipPermissions?: boolean | undefined;
        outputFormat?: "text" | "stream-json" | undefined;
        extraArgs?: string[] | undefined;
    }>;
    name: z.ZodString;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool: "CLAUDE_CODE";
    claudeCode: {
        disableNonessentialTraffic: boolean;
        skipPermissions: boolean;
        outputFormat: "text" | "stream-json";
        extraArgs: string[];
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        effortLevel?: string | undefined;
    };
    name: string;
    metadata?: string | undefined;
}, {
    tool: "CLAUDE_CODE";
    claudeCode: {
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        disableNonessentialTraffic?: boolean | undefined;
        effortLevel?: string | undefined;
        skipPermissions?: boolean | undefined;
        outputFormat?: "text" | "stream-json" | undefined;
        extraArgs?: string[] | undefined;
    };
    name: string;
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
        baseUrl?: string | undefined;
        model?: string | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
    }, {
        baseUrl?: string | undefined;
        model?: string | undefined;
        extraArgs?: string[] | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
        fullAuto?: boolean | undefined;
        bypassApprovalsAndSandbox?: boolean | undefined;
    }>;
    name: z.ZodString;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool: "OPENAI";
    name: string;
    codex: {
        extraArgs: string[];
        fullAuto: boolean;
        bypassApprovalsAndSandbox: boolean;
        baseUrl?: string | undefined;
        model?: string | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
    };
    metadata?: string | undefined;
}, {
    tool: "OPENAI";
    name: string;
    codex: {
        baseUrl?: string | undefined;
        model?: string | undefined;
        extraArgs?: string[] | undefined;
        apiKey?: string | undefined;
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
    metadata?: string | undefined;
}>;
export type CustomProfile = z.infer<typeof CustomProfile>;
export declare const ReasonixProfile: z.ZodObject<{
    tool: z.ZodLiteral<"REASONIX">;
    reasonix: z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        extraArgs: string[];
        model?: string | undefined;
    }, {
        model?: string | undefined;
        extraArgs?: string[] | undefined;
    }>;
    name: z.ZodString;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool: "REASONIX";
    name: string;
    reasonix: {
        extraArgs: string[];
        model?: string | undefined;
    };
    metadata?: string | undefined;
}, {
    tool: "REASONIX";
    name: string;
    reasonix: {
        model?: string | undefined;
        extraArgs?: string[] | undefined;
    };
    metadata?: string | undefined;
}>;
export type ReasonixProfile = z.infer<typeof ReasonixProfile>;
export declare const Profile: z.ZodDiscriminatedUnion<"tool", [z.ZodObject<{
    tool: z.ZodLiteral<"CLAUDE_CODE">;
    claudeCode: z.ZodObject<{
        baseUrl: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        authToken: z.ZodOptional<z.ZodString>;
        defaultOpusModel: z.ZodOptional<z.ZodString>;
        defaultSonnetModel: z.ZodOptional<z.ZodString>;
        defaultHaikuModel: z.ZodOptional<z.ZodString>;
        disableNonessentialTraffic: z.ZodDefault<z.ZodBoolean>;
        effortLevel: z.ZodOptional<z.ZodString>;
        skipPermissions: z.ZodDefault<z.ZodBoolean>;
        outputFormat: z.ZodDefault<z.ZodEnum<["text", "stream-json"]>>;
        extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        disableNonessentialTraffic: boolean;
        skipPermissions: boolean;
        outputFormat: "text" | "stream-json";
        extraArgs: string[];
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        effortLevel?: string | undefined;
    }, {
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        disableNonessentialTraffic?: boolean | undefined;
        effortLevel?: string | undefined;
        skipPermissions?: boolean | undefined;
        outputFormat?: "text" | "stream-json" | undefined;
        extraArgs?: string[] | undefined;
    }>;
    name: z.ZodString;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool: "CLAUDE_CODE";
    claudeCode: {
        disableNonessentialTraffic: boolean;
        skipPermissions: boolean;
        outputFormat: "text" | "stream-json";
        extraArgs: string[];
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        effortLevel?: string | undefined;
    };
    name: string;
    metadata?: string | undefined;
}, {
    tool: "CLAUDE_CODE";
    claudeCode: {
        baseUrl?: string | undefined;
        model?: string | undefined;
        authToken?: string | undefined;
        defaultOpusModel?: string | undefined;
        defaultSonnetModel?: string | undefined;
        defaultHaikuModel?: string | undefined;
        disableNonessentialTraffic?: boolean | undefined;
        effortLevel?: string | undefined;
        skipPermissions?: boolean | undefined;
        outputFormat?: "text" | "stream-json" | undefined;
        extraArgs?: string[] | undefined;
    };
    name: string;
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
        baseUrl?: string | undefined;
        model?: string | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
    }, {
        baseUrl?: string | undefined;
        model?: string | undefined;
        extraArgs?: string[] | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
        fullAuto?: boolean | undefined;
        bypassApprovalsAndSandbox?: boolean | undefined;
    }>;
    name: z.ZodString;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool: "OPENAI";
    name: string;
    codex: {
        extraArgs: string[];
        fullAuto: boolean;
        bypassApprovalsAndSandbox: boolean;
        baseUrl?: string | undefined;
        model?: string | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
    };
    metadata?: string | undefined;
}, {
    tool: "OPENAI";
    name: string;
    codex: {
        baseUrl?: string | undefined;
        model?: string | undefined;
        extraArgs?: string[] | undefined;
        apiKey?: string | undefined;
        sandboxMode?: "read-only" | "workspace-write" | "danger-full-access" | undefined;
        approvalMode?: "never" | "on-request" | "on-failure" | "untrusted" | undefined;
        fullAuto?: boolean | undefined;
        bypassApprovalsAndSandbox?: boolean | undefined;
    };
    metadata?: string | undefined;
}>, z.ZodObject<{
    tool: z.ZodLiteral<"REASONIX">;
    reasonix: z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        extraArgs: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        extraArgs: string[];
        model?: string | undefined;
    }, {
        model?: string | undefined;
        extraArgs?: string[] | undefined;
    }>;
    name: z.ZodString;
    metadata: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool: "REASONIX";
    name: string;
    reasonix: {
        extraArgs: string[];
        model?: string | undefined;
    };
    metadata?: string | undefined;
}, {
    tool: "REASONIX";
    name: string;
    reasonix: {
        model?: string | undefined;
        extraArgs?: string[] | undefined;
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
    metadata?: string | undefined;
}>]>;
export type Profile = z.infer<typeof Profile>;
export { TOOL_KINDS };
//# sourceMappingURL=profile.d.ts.map