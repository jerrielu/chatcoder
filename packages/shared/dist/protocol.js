import { z } from "zod";
import { CODEX_REASONING_EFFORTS, MAX_INSTRUCTION_BYTES, MAX_PROFILES_PER_DAEMON, MAX_PROFILE_NAME_LENGTH, MAX_RESPONSE_BYTES, MAX_WORK_DIRS, MESSAGE_KINDS, TOOL_KINDS } from "./constants.js";
/* ===================== Wire types ===================== */
export const DaemonMessage = z.object({
    id: z.string().min(1),
    content: z.string().min(1).max(MAX_INSTRUCTION_BYTES),
    /** true = daemon should resume last CLI session; false = start fresh. */
    resumeLastSession: z.boolean().default(true),
    /** Optional Codex reasoning effort override for OPENAI profiles. */
    codexReasoningEffort: z.enum(CODEX_REASONING_EFFORTS).optional(),
    /** Message kind: "instruction" (normal) or "stop" (abort current execution). */
    kind: z.enum(MESSAGE_KINDS).default("instruction"),
    createdAt: z.number().int().nonnegative()
});
/** Shape of one session returned by GET /v1/poll. */
export const PollSession = z.object({
    sessionId: z.string().min(1),
    profileName: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH),
    workDir: z.string().optional(),
    messages: z.array(DaemonMessage)
});
export const PollResponse = z.object({
    reset: z.boolean(),
    sessions: z.array(PollSession)
});
export const PostResponseBody = z.object({
    sessionId: z.string().min(1),
    content: z.string().min(1).max(MAX_RESPONSE_BYTES),
    /** false = progress update only; true = send final result to client. */
    final: z.boolean().default(true),
    /** Optional echo of originating instruction id for tracing. */
    replyTo: z.string().min(1).optional(),
    /** Full raw tool output before Telegram formatting, for the .md attachment. */
    rawContent: z.string().optional()
});
/* ===================== Daemon registration ===================== */
const ProfileName = z
    .string()
    .min(1)
    .max(MAX_PROFILE_NAME_LENGTH)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Profile name must be slug-like");
export const RegisteredProfile = z.object({
    name: ProfileName,
    tool: z.enum(TOOL_KINDS),
    metadata: z.string().max(500).optional()
});
export const DaemonRegisterBody = z.object({
    profiles: z.array(RegisteredProfile).max(MAX_PROFILES_PER_DAEMON),
    workDirs: z.array(z.string().min(1).max(512)).max(MAX_WORK_DIRS).optional()
});
export const DaemonRegisterResponse = z.object({
    apiKeyId: z.string().min(1),
    profiles: z.array(z.object({
        id: z.string().min(1),
        name: ProfileName,
        tool: z.enum(TOOL_KINDS)
    }))
});
/* ===================== Heartbeat ===================== */
export const HeartbeatBody = z.object({
    /** Semver of the running daemon, for future compatibility gates. */
    version: z.string().min(1).max(32).optional(),
    /** Free-form status blurb. */
    note: z.string().max(200).optional(),
    /** Periodic re-registration of profiles (same shape as DaemonRegisterBody). */
    profiles: z.array(RegisteredProfile).max(MAX_PROFILES_PER_DAEMON).optional(),
    /** Periodic re-registration of work dirs. */
    workDirs: z.array(z.string().min(1).max(512)).max(MAX_WORK_DIRS).optional()
});
export const HeartbeatResponse = z.object({
    ok: z.literal(true),
    reset: z.boolean(),
    serverTime: z.number().int().nonnegative()
});
//# sourceMappingURL=protocol.js.map