import Fastify, { type FastifyInstance } from "fastify";
import {
  ADMIN_API_PREFIX,
  API_PATHS,
  HeartbeatBody,
  PostResponseBody,
  type HeartbeatResponse,
  type PollResponse,
  type SessionInfoResponse
} from "@chatcoder/shared";
import type { SessionsRepo } from "../db/sessions.js";
import type { MessagesRepo } from "../db/messages.js";
import type { AdminRepo } from "../db/admin.js";
import { installAuth } from "./auth.js";
import { installErrorHandler } from "./errorHandler.js";
import { installLoopbackGuard } from "./loopbackGuard.js";
import { installAdminCors } from "./cors.js";
import { registerAdminRoutes } from "./admin.js";

export interface BuildServerOptions {
  sessionsRepo: SessionsRepo;
  messagesRepo: MessagesRepo;
  adminRepo: AdminRepo;
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
    sessionsRepo: opts.sessionsRepo,
    protectedPrefix: API_PREFIX,
    skipPrefixes: [ADMIN_API_PREFIX]
  });

  app.post(API_PATHS.heartbeat, async (req): Promise<HeartbeatResponse> => {
    HeartbeatBody.parse(req.body ?? {});
    await opts.sessionsRepo.updateHeartbeat(req.session.id);
    return { ok: true, reset: false, serverTime: Date.now() };
  });

  app.get(API_PATHS.poll, async (req): Promise<PollResponse> => {
    // A valid request means the session is live (auth plugin already checked revoked).
    await opts.sessionsRepo.updateHeartbeat(req.session.id);
    const messages = await opts.messagesRepo.drain(req.session.id, "to_daemon");
    return {
      reset: false,
      sessionValid: true,
      messages: messages.map((m) => ({
        id: m.id,
        content: m.content,
        createdAt: m.createdAt
      }))
    };
  });

  app.post(API_PATHS.responses, async (req): Promise<{ ok: true; droppedOldestId: string | null }> => {
    const body = PostResponseBody.parse(req.body);
    const { droppedOldestId } = await opts.messagesRepo.enqueue({
      sessionId: req.session.id,
      direction: "to_user",
      content: body.content
    });
    return { ok: true, droppedOldestId };
  });

  app.get(API_PATHS.session, async (req): Promise<SessionInfoResponse> => {
    const [pendingInstructions, pendingResponses] = await Promise.all([
      opts.messagesRepo.count(req.session.id, "to_daemon"),
      opts.messagesRepo.count(req.session.id, "to_user")
    ]);
    return {
      sessionId: req.session.id,
      apiKeyPrefix: req.session.apiKeyPrefix,
      createdAt: req.session.createdAt,
      status: req.session.status,
      pendingInstructions,
      pendingResponses,
      lastHeartbeat: req.session.lastHeartbeat
    };
  });

  registerAdminRoutes(app, {
    sessions: opts.sessionsRepo,
    messages: opts.messagesRepo,
    admin: opts.adminRepo
  });

  return app;
}
