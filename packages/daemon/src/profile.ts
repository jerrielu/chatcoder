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
} as const;

export const ClaudeCodeConfig = z.object({
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
  authToken: z.string().min(1).optional(),
  defaultOpusModel: z.string().optional(),
  defaultSonnetModel: z.string().optional(),
  defaultHaikuModel: z.string().optional(),
  disableNonessentialTraffic: z.boolean().default(false),
  effortLevel: z.string().optional(),
  skipPermissions: z.boolean().default(false),
  outputFormat: z.enum(["text", "stream-json"]).default("text"),
  extraArgs: z.array(z.string()).default([])
});
export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfig>;

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
export type CodexConfig = z.infer<typeof CodexConfig>;

const EnvKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const CustomConfig = z.object({
  launchBin: z.string().min(1).regex(/^\S+$/, "launchBin must not contain whitespace"),
  args: z.array(z.string()).default([]),
  env: z.record(EnvKey, z.string()).default({}),
  messagePlacement: z
    .enum(["appended", "stdin", "placeholder"])
    .default("appended")
});
export type CustomConfig = z.infer<typeof CustomConfig>;

export const ClaudeCodeProfile = z.object({
  ...BaseProfile,
  tool: z.literal("CLAUDE_CODE"),
  claudeCode: ClaudeCodeConfig
});
export type ClaudeCodeProfile = z.infer<typeof ClaudeCodeProfile>;

export const OpenAIProfile = z.object({
  ...BaseProfile,
  tool: z.literal("OPENAI"),
  codex: CodexConfig
});
export type OpenAIProfile = z.infer<typeof OpenAIProfile>;

export const CustomProfile = z.object({
  ...BaseProfile,
  tool: z.literal("CUSTOM"),
  custom: CustomConfig
});
export type CustomProfile = z.infer<typeof CustomProfile>;

export const Profile = z.discriminatedUnion("tool", [
  ClaudeCodeProfile,
  OpenAIProfile,
  CustomProfile
]);
export type Profile = z.infer<typeof Profile>;

export { TOOL_KINDS };
