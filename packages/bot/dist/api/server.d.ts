import { type FastifyInstance } from "fastify";
import type { ApiKeysRepo } from "../db/apiKeys.js";
import type { ProfilesRepo } from "../db/profiles.js";
import type { SessionsRepo } from "../db/sessions.js";
import type { MessagesRepo } from "../db/messages.js";
import type { AdminRepo } from "../db/admin.js";
import { type TelegramSender } from "../bot/telegramSend.js";
export interface BuildServerOptions {
    apiKeysRepo: ApiKeysRepo;
    profilesRepo: ProfilesRepo;
    sessionsRepo: SessionsRepo;
    messagesRepo: MessagesRepo;
    adminRepo: AdminRepo;
    telegram: TelegramSender;
    logger?: boolean | object;
}
export declare function buildServer(opts: BuildServerOptions): Promise<FastifyInstance>;
//# sourceMappingURL=server.d.ts.map