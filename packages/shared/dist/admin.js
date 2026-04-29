import { z } from "zod";
import { CODEX_REASONING_EFFORTS, MAX_INSTRUCTION_BYTES, MAX_PROFILE_NAME_LENGTH, MIN_API_KEY_LENGTH, TOOL_KINDS } from "./constants.js";
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
export const AdminProfile = z.object({
    id: z.string(),
    apiKeyId: z.string(),
    name: z.string().min(1).max(MAX_PROFILE_NAME_LENGTH),
    tool: z.enum(TOOL_KINDS),
    metadata: z.string().nullable(),
    createdAt: z.number().int()
});
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
export const AdminMessage = z.object({
    id: z.string(),
    sessionId: z.string(),
    content: z.string(),
    resumeLastSession: z.boolean().default(true),
    codexReasoningEffort: z.enum(CODEX_REASONING_EFFORTS).optional(),
    processingStartedAt: z.number().int().nullable().default(null),
    createdAt: z.number().int()
});
/* ----- API keys: list ----- */
export const ListApiKeysResponse = z.object({
    apiKeys: z.array(AdminApiKey),
    total: z.number().int().nonnegative()
});
export const ApiKeyDetailResponse = z.object({
    apiKey: AdminApiKey,
    profiles: z.array(AdminProfile),
    sessions: z.array(AdminSession)
});
/* ----- Sessions: list + filters ----- */
export const ListSessionsQuery = z.object({
    status: z.enum(["active", "revoked"]).optional(),
    chatId: z.coerce.number().int().optional(),
    apiKeyId: z.string().optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().nonnegative().optional()
});
export const ListSessionsResponse = z.object({
    sessions: z.array(AdminSession),
    total: z.number().int().nonnegative()
});
/* ----- Session detail ----- */
export const SessionDetailResponse = z.object({
    session: AdminSession,
    pending: z.number().int().nonnegative(),
    messages: z.array(AdminMessage)
});
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
    resumeLastSession: z.boolean().optional(),
    codexReasoningEffort: z.enum(CODEX_REASONING_EFFORTS).optional()
});
export const EnqueueMessageResponse = z.object({
    message: AdminMessage,
    droppedOldestId: z.string().nullable()
});
export const UpdateMessageBody = z.object({
    content: z.string().min(1).max(MAX_INSTRUCTION_BYTES)
});
export const ListMessagesResponse = z.object({
    messages: z.array(AdminMessage)
});
//# sourceMappingURL=admin.js.map