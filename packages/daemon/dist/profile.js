import { z } from "zod";
import { MAX_PROFILE_NAME_LENGTH, TOOL_KINDS } from "@chatcoder/shared";
const ProfileName = z
    .string()
    .min(1)
    .max(MAX_PROFILE_NAME_LENGTH)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Profile name must be slug-like");
const BaseProfile = {
    name: ProfileName,
    metadata: z.string().max(500).optional()
};
export const ClaudeCodeConfig = z.object({
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
    authToken: z.string().min(1),
    defaultOpusModel: z.string().optional(),
    defaultSonnetModel: z.string().optional(),
    defaultHaikuModel: z.string().optional(),
    disableNonessentialTraffic: z.boolean().default(false),
    effortLevel: z.string().optional(),
    skipPermissions: z.boolean().default(false),
    outputFormat: z.enum(["text", "stream-json"]).default("text"),
    extraArgs: z.array(z.string()).default([])
});
export const CodexConfig = z.object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
    sandboxMode: z
        .enum(["read-only", "workspace-write", "danger-full-access"])
        .optional(),
    approvalMode: z
        .enum(["never", "on-request", "on-failure", "untrusted"])
        .optional(),
    fullAuto: z.boolean().default(false),
    bypassApprovalsAndSandbox: z.boolean().default(false),
    extraArgs: z.array(z.string()).default([])
});
const EnvKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const CustomConfig = z.object({
    launchBin: z.string().min(1).regex(/^\S+$/, "launchBin must not contain whitespace"),
    args: z.array(z.string()).default([]),
    env: z.record(EnvKey, z.string()).default({}),
    messagePlacement: z
        .enum(["appended", "stdin", "placeholder"])
        .default("appended")
});
export const ClaudeCodeProfile = z.object({
    ...BaseProfile,
    tool: z.literal("CLAUDE_CODE"),
    claudeCode: ClaudeCodeConfig
});
export const OpenAIProfile = z.object({
    ...BaseProfile,
    tool: z.literal("OPENAI"),
    codex: CodexConfig
});
export const CustomProfile = z.object({
    ...BaseProfile,
    tool: z.literal("CUSTOM"),
    custom: CustomConfig
});
export const Profile = z.discriminatedUnion("tool", [
    ClaudeCodeProfile,
    OpenAIProfile,
    CustomProfile
]);
export { TOOL_KINDS };
//# sourceMappingURL=profile.js.map