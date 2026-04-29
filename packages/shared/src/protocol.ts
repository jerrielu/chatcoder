import { z } from "zod";
import {
  CODEX_REASONING_EFFORTS,
  MAX_INSTRUCTION_BYTES,
  MAX_PROFILES_PER_DAEMON,
  MAX_PROFILE_NAME_LENGTH,
  MAX_RESPONSE_BYTES,
  TOOL_KINDS
} from "./constants.js";

/* ===================== Wire types ===================== */

export const DaemonMessage = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(MAX_INSTRUCTION_BYTES),
  /** true = daemon should resume last CLI session; false = start fresh. */
  resumeLastSession: z.boolean().default(true),
  /** Optional Codex reasoning effort override for OPENAI profiles. */
  codexReasoningEffort: z.enum(CODEX_REASONING_EFFORTS).optional(),
  createdAt: z.number().int().nonnegative()
});
export type DaemonMessage = z.infer<typeof DaemonMessage>;

/** Shape of one session returned by GET /v1/poll. */
export const PollSession = z.object({
  sessionId: z.string().min(1),
  profileName: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH),
  messages: z.array(DaemonMessage)
});
export type PollSession = z.infer<typeof PollSession>;

export const PollResponse = z.object({
  reset: z.boolean(),
  sessions: z.array(PollSession)
});
export type PollResponse = z.infer<typeof PollResponse>;

export const PostResponseBody = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(MAX_RESPONSE_BYTES),
  /** false = progress update only; true = send final result to client. */
  final: z.boolean().default(true),
  /** Optional echo of originating instruction id for tracing. */
  replyTo: z.string().min(1).optional()
});
export type PostResponseBody = z.infer<typeof PostResponseBody>;

export const HeartbeatBody = z.object({
  /** Semver of the running daemon, for future compatibility gates. */
  version: z.string().min(1).max(32).optional(),
  /** Free-form status blurb. */
  note: z.string().max(200).optional()
});
export type HeartbeatBody = z.infer<typeof HeartbeatBody>;

export const HeartbeatResponse = z.object({
  ok: z.literal(true),
  reset: z.boolean(),
  serverTime: z.number().int().nonnegative()
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;

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
export type RegisteredProfile = z.infer<typeof RegisteredProfile>;

export const DaemonRegisterBody = z.object({
  profiles: z.array(RegisteredProfile).max(MAX_PROFILES_PER_DAEMON)
});
export type DaemonRegisterBody = z.infer<typeof DaemonRegisterBody>;

export const DaemonRegisterResponse = z.object({
  apiKeyId: z.string().min(1),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      name: ProfileName,
      tool: z.enum(TOOL_KINDS)
    })
  )
});
export type DaemonRegisterResponse = z.infer<typeof DaemonRegisterResponse>;
