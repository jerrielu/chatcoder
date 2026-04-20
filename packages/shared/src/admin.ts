import { z } from "zod";
import { MAX_INSTRUCTION_BYTES, MAX_RESPONSE_BYTES, MIN_API_KEY_LENGTH } from "./constants.js";
import { MessageDirection } from "./protocol.js";

/* ===================== Admin wire types =====================
 *
 * Consumed by the local dashboard over /v1/admin/*. The dashboard is the only
 * intended caller; these shapes intentionally omit internal fields like
 * api_key_hash and last_code_at that the UI never needs.
 */

export const AdminSession = z.object({
  id: z.string(),
  chatId: z.number().int(),
  apiKeyPrefix: z.string(),
  status: z.enum(["active", "revoked"]),
  createdAt: z.number().int(),
  revokedAt: z.number().int().nullable(),
  lastHeartbeat: z.number().int().nullable()
});
export type AdminSession = z.infer<typeof AdminSession>;

export const AdminMessage = z.object({
  id: z.string(),
  sessionId: z.string(),
  direction: MessageDirection,
  content: z.string(),
  createdAt: z.number().int()
});
export type AdminMessage = z.infer<typeof AdminMessage>;

/* ----- Sessions: list + filters ----- */

export const ListSessionsQuery = z.object({
  status: z.enum(["active", "revoked"]).optional(),
  chatId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});
export type ListSessionsQuery = z.infer<typeof ListSessionsQuery>;

export const ListSessionsResponse = z.object({
  sessions: z.array(AdminSession),
  total: z.number().int().nonnegative()
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponse>;

/* ----- Sessions: create / rotate ----- */

const optionalKey = z
  .string()
  .min(MIN_API_KEY_LENGTH)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const CreateSessionBody = z.object({
  chatId: z.coerce.number().int(),
  rawApiKey: optionalKey
});
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

export const RotateSessionBody = z.object({
  rawApiKey: optionalKey
});
export type RotateSessionBody = z.infer<typeof RotateSessionBody>;

export const CreateSessionResponse = z.object({
  session: AdminSession,
  rawApiKey: z.string()
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

/* ----- Sessions: update ----- */

export const UpdateSessionBody = z.object({
  chatId: z.coerce.number().int()
});
export type UpdateSessionBody = z.infer<typeof UpdateSessionBody>;

/* ----- Session detail: single call backing the detail page ----- */

export const SessionDetailResponse = z.object({
  session: AdminSession,
  pendingToDaemon: z.number().int().nonnegative(),
  pendingToUser: z.number().int().nonnegative(),
  messages: z.array(AdminMessage)
});
export type SessionDetailResponse = z.infer<typeof SessionDetailResponse>;

/* ----- Messages ----- */

export const EnqueueMessageBody = z
  .object({
    direction: MessageDirection,
    content: z.string().min(1)
  })
  .refine(
    (b) =>
      b.direction === "to_daemon"
        ? b.content.length <= MAX_INSTRUCTION_BYTES
        : b.content.length <= MAX_RESPONSE_BYTES,
    { message: "content exceeds max bytes for direction", path: ["content"] }
  );
export type EnqueueMessageBody = z.infer<typeof EnqueueMessageBody>;

export const EnqueueMessageResponse = z.object({
  message: AdminMessage,
  droppedOldestId: z.string().nullable()
});
export type EnqueueMessageResponse = z.infer<typeof EnqueueMessageResponse>;

export const UpdateMessageBody = z.object({
  content: z.string().min(1).max(MAX_RESPONSE_BYTES)
});
export type UpdateMessageBody = z.infer<typeof UpdateMessageBody>;

export const ListMessagesQuery = z.object({
  direction: MessageDirection.optional()
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const ListMessagesResponse = z.object({
  messages: z.array(AdminMessage)
});
export type ListMessagesResponse = z.infer<typeof ListMessagesResponse>;
