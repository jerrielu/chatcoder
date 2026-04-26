import type { FastifyInstance } from "fastify";
import type { AdminRepo } from "../db/admin.js";
import type { MessagesRepo } from "../db/messages.js";
import type { SessionsRepo } from "../db/sessions.js";
import type { ApiKeysRepo } from "../db/apiKeys.js";
import type { ProfilesRepo } from "../db/profiles.js";
export interface AdminRoutesDeps {
    apiKeys: ApiKeysRepo;
    profiles: ProfilesRepo;
    sessions: SessionsRepo;
    messages: MessagesRepo;
    admin: AdminRepo;
}
export declare function registerAdminRoutes(app: FastifyInstance, deps: AdminRoutesDeps): void;
//# sourceMappingURL=admin.d.ts.map