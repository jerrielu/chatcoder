import { z } from "zod";
import { MAX_INSTRUCTION_BYTES, MAX_RESPONSE_BYTES } from "./constants.js";

/* ===================== Wire types ===================== */

export const MessageDirection = z.enum(["to_daemon", "to_user"]);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const DaemonMessage = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(MAX_INSTRUCTION_BYTES),
  createdAt: z.number().int().nonnegative()
});
export type DaemonMessage = z.infer<typeof DaemonMessage>;

export const PollResponse = z.object({
  reset: z.boolean(),
  sessionValid: z.boolean(),
  messages: z.array(DaemonMessage)
});
export type PollResponse = z.infer<typeof PollResponse>;

export const PostResponseBody = z.object({
  content: z.string().min(1).max(MAX_RESPONSE_BYTES),
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

export const SessionInfoResponse = z.object({
  sessionId: z.string(),
  apiKeyPrefix: z.string(),
  createdAt: z.number().int(),
  status: z.enum(["active", "revoked"]),
  pendingInstructions: z.number().int().nonnegative(),
  pendingResponses: z.number().int().nonnegative(),
  lastHeartbeat: z.number().int().nullable()
});
export type SessionInfoResponse = z.infer<typeof SessionInfoResponse>;
