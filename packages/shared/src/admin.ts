import { z } from "zod";
import {
  MAX_INSTRUCTION_BYTES,
  MAX_PROFILE_NAME_LENGTH,
  MIN_API_KEY_LENGTH,
  TOOL_KINDS
} from "./constants.js";

/* ===================== Admin wire types =====================
 *
 * Consumed by the local dashboard over /v1/admin/*. The dashboard is the only
 * intended caller; these shapes omit internal fields like api_key_hash that
 * the UI never needs.
 */

export const AdminApiKey = z.object({
  id: z.string(),
  apiKeyPrefix: z.string(),
  status: z.enum(["active", "revoked"]),
  createdAt: z.number().int(),
  revokedAt: z.number().int().nullable(),
  lastHeartbeat: z.number().int().nullable()
});
export type AdminApiKey = z.infer<typeof AdminApiKey>;

export const AdminProfile = z.object({
  id: z.string(),
  apiKeyId: z.string(),
  name: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH),
  tool: z.enum(TOOL_KINDS),
  metadata: z.string().nullable(),
  createdAt: z.number().int()
});
export type AdminProfile = z.infer<typeof AdminProfile>;

export const AdminSession = z.object({
  id: z.string(),
  chatId: z.number().int(),
  apiKeyId: z.string(),
  apiKeyPrefix: z.string(),
  apiKeyLastHeartbeat: z.number().int().nullable(),
  profileId: z.string(),
  profileName: z.string(),
  profileTool: z.enum(TOOL_KINDS),
  status: z.enum(["active", "revoked"]),
  createdAt: z.number().int(),
  revokedAt: z.number().int().nullable()
});
export type AdminSession = z.infer<typeof AdminSession>;

export const AdminMessage = z.object({
  id: z.string(),
  sessionId: z.string(),
  content: z.string(),
  resumeLastSession: z.boolean().default(true),
  createdAt: z.number().int()
});
export type AdminMessage = z.infer<typeof AdminMessage>;

/* ----- API keys: list ----- */

export const ListApiKeysResponse = z.object({
  apiKeys: z.array(AdminApiKey),
  total: z.number().int().nonnegative()
});
export type ListApiKeysResponse = z.infer<typeof ListApiKeysResponse>;

export const ApiKeyDetailResponse = z.object({
  apiKey: AdminApiKey,
  profiles: z.array(AdminProfile),
  sessions: z.array(AdminSession)
});
export type ApiKeyDetailResponse = z.infer<typeof ApiKeyDetailResponse>;

/* ----- Sessions: list + filters ----- */

export const ListSessionsQuery = z.object({
  status: z.enum(["active", "revoked"]).optional(),
  chatId: z.coerce.number().int().optional(),
  apiKeyId: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});
export type ListSessionsQuery = z.infer<typeof ListSessionsQuery>;

export const ListSessionsResponse = z.object({
  sessions: z.array(AdminSession),
  total: z.number().int().nonnegative()
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponse>;

/* ----- Session detail ----- */

export const SessionDetailResponse = z.object({
  session: AdminSession,
  pending: z.number().int().nonnegative(),
  messages: z.array(AdminMessage)
});
export type SessionDetailResponse = z.infer<typeof SessionDetailResponse>;

/* ----- Messages ----- */

const optionalKey = z
  .string()
  .min(MIN_API_KEY_LENGTH)
  .optional()
  .or(z.literal("").transform(() => undefined));

/** Kept for test compatibility with the old admin transport contract. */
export const ReservedOptionalKey = optionalKey;

export const EnqueueMessageBody = z.object({
  content: z.string().min(1).max(MAX_INSTRUCTION_BYTES),
  resumeLastSession: z.boolean().optional()
});
export type EnqueueMessageBody = z.infer<typeof EnqueueMessageBody>;

export const EnqueueMessageResponse = z.object({
  message: AdminMessage,
  droppedOldestId: z.string().nullable()
});
export type EnqueueMessageResponse = z.infer<typeof EnqueueMessageResponse>;

export const UpdateMessageBody = z.object({
  content: z.string().min(1).max(MAX_INSTRUCTION_BYTES)
});
export type UpdateMessageBody = z.infer<typeof UpdateMessageBody>;

export const ListMessagesResponse = z.object({
  messages: z.array(AdminMessage)
});
export type ListMessagesResponse = z.infer<typeof ListMessagesResponse>;
