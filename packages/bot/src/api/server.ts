import Fastify, { type FastifyInstance } from "fastify";
import {
  ADMIN_API_PREFIX,
  API_PATHS,
  ApiError,
  DaemonMessage,
  DaemonRegisterBody,
  HeartbeatBody,
  PostResponseBody,
  MIN_API_KEY_LENGTH,
  type DaemonRegisterResponse,
  type HeartbeatResponse,
  type PollResponse,
  type PollSession
} from "@chatcoder/shared";
import { validateUserSuppliedKey } from "../db/crypto.js";
import type { ApiKeysRepo } from "../db/apiKeys.js";
import type { ProfilesRepo } from "../db/profiles.js";
import type { SessionsRepo } from "../db/sessions.js";
import type { MessagesRepo } from "../db/messages.js";
import type { AdminRepo } from "../db/admin.js";
import { extractBearer, installAuth } from "./auth.js";
import { installErrorHandler } from "./errorHandler.js";
import { installLoopbackGuard } from "./loopbackGuard.js";
import { installAdminCors } from "./cors.js";
import { registerAdminRoutes } from "./admin.js";
import { toApiErrorIfPermanent, type TelegramSender } from "../bot/telegramSend.js";

export interface BuildServerOptions {
  apiKeysRepo: ApiKeysRepo;
  profilesRepo: ProfilesRepo;
  sessionsRepo: SessionsRepo;
  messagesRepo: MessagesRepo;
  adminRepo: AdminRepo;
  telegram: TelegramSender;
  logger?: boolean | object;
}

const API_PREFIX = "/v1";

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 64 * 1024
  });

  await installAdminCors(app);
  installErrorHandler(app);
  installLoopbackGuard(app, ADMIN_API_PREFIX);
  installAuth(app, {
    apiKeysRepo: opts.apiKeysRepo,
    protectedPrefix: API_PREFIX,
    skipPrefixes: [ADMIN_API_PREFIX, API_PATHS.daemonRegister]
  });

  /* ---------------- Daemon register (bootstraps the api_key row) ---------------- */

  app.post(API_PATHS.daemonRegister, async (req): Promise<DaemonRegisterResponse> => {
    const raw = extractBearer(req);
    if (!raw) throw ApiError.unauthorized("Missing bearer token");
    if (raw.length < MIN_API_KEY_LENGTH) {
      throw ApiError.validation(
        `API key must be at least ${MIN_API_KEY_LENGTH} characters.`
      );
    }
    try {
      validateUserSuppliedKey(raw);
    } catch (e) {
      throw ApiError.validation((e as Error).message);
    }

    const body = DaemonRegisterBody.parse(req.body ?? {});

    const apiKey = await opts.apiKeysRepo.registerByRawKey(raw);
    const profiles = await opts.profilesRepo.upsertForApiKey(
      apiKey.id,
      body.profiles.map((p) => ({
        name: p.name,
        tool: p.tool,
        metadata: p.metadata ?? null
      }))
    );
    return {
      apiKeyId: apiKey.id,
      profiles: profiles.map((p) => ({ id: p.id, name: p.name, tool: p.tool }))
    };
  });

  /* ---------------- Daemon control loop ---------------- */

  app.post(API_PATHS.heartbeat, async (req): Promise<HeartbeatResponse> => {
    HeartbeatBody.parse(req.body ?? {});
    await opts.apiKeysRepo.updateHeartbeat(req.apiKey.id);
    return { ok: true, reset: false, serverTime: Date.now() };
  });

  app.get(API_PATHS.poll, async (req): Promise<PollResponse> => {
    await opts.apiKeysRepo.updateHeartbeat(req.apiKey.id);
    const sessions = await opts.sessionsRepo.listActiveByApiKey(req.apiKey.id);
    const grouped: PollSession[] = [];
    for (const s of sessions) {
      const profile = await opts.profilesRepo.getById(s.profileId);
      if (!profile) continue;
      const msgs = await opts.messagesRepo.drain(s.id);
      if (msgs.length === 0) continue;
      grouped.push({
        sessionId: s.id,
        profileName: profile.name,
        messages: msgs.map((m) =>
          DaemonMessage.parse({
            id: m.id,
            content: m.content,
            resumeLastSession: m.resumeLastSession,
            createdAt: m.createdAt
          })
        )
      });
    }
    return { reset: false, sessions: grouped };
  });

  app.post(API_PATHS.responses, async (req): Promise<{ ok: true }> => {
    const body = PostResponseBody.parse(req.body);
    const session = await opts.sessionsRepo.getById(body.sessionId);
    if (!session || session.apiKeyId !== req.apiKey.id) {
      throw ApiError.validation("Unknown sessionId for this API key");
    }
    if (session.status !== "active") {
      throw ApiError.sessionRevoked();
    }
    if (!body.final) {
      await opts.sessionsRepo.setLatestMessage(session.id, body.content);
      return { ok: true };
    }
    try {
      await opts.telegram.sendResponse(session.chatId, body.content);
    } catch (e) {
      const mapped = toApiErrorIfPermanent(e);
      if (mapped) throw mapped;
      throw e;
    }
    return { ok: true };
  });

  registerAdminRoutes(app, {
    apiKeys: opts.apiKeysRepo,
    profiles: opts.profilesRepo,
    sessions: opts.sessionsRepo,
    messages: opts.messagesRepo,
    admin: opts.adminRepo
  });

  return app;
}
