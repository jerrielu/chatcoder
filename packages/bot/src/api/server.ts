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
const RESUME_IN_PROGRESS_CONTENT = "continue";

function wantsResumeInProgress(query: unknown): boolean {
  if (!query || typeof query !== "object") return false;
  const value = (query as { resumeInProgress?: unknown }).resumeInProgress;
  return value === "1" || value === "true" || value === true;
}

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
    if (body.workDirs) {
      await opts.apiKeysRepo.setWorkDirs(apiKey.id, body.workDirs);
    }
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
    const body = HeartbeatBody.parse(req.body ?? {});
    if (body.profiles) {
      await opts.profilesRepo.upsertForApiKey(
        req.apiKey.id,
        body.profiles.map((p) => ({
          name: p.name,
          tool: p.tool,
          metadata: p.metadata ?? null
        }))
      );
      if (body.workDirs) {
        await opts.apiKeysRepo.setWorkDirs(req.apiKey.id, body.workDirs);
      }
    }
    await opts.apiKeysRepo.updateHeartbeat(req.apiKey.id);
    return { ok: true, reset: false, serverTime: Date.now() };
  });

  app.get(API_PATHS.poll, async (req): Promise<PollResponse> => {
    await opts.apiKeysRepo.updateHeartbeat(req.apiKey.id);
    const resumeInProgress = wantsResumeInProgress(req.query);
    const sessions = await opts.sessionsRepo.listActiveByApiKey(req.apiKey.id);
    const grouped: PollSession[] = [];
    for (const s of sessions) {
      const profile = await opts.profilesRepo.getById(s.profileId);
      if (!profile) continue;
      let notifyProcessing = false;
      // Stop messages take priority — claim even if something is in progress
      let msg = await opts.messagesRepo.claimStop(s.id);
      if (msg) {
        // Stop messages are control signals, skip the "processing" notification
        notifyProcessing = false;
      } else {
        msg = await opts.messagesRepo.claimLatestNewCodeAndClearBefore(s.id);
        if (msg) {
          notifyProcessing = true;
        } else if (resumeInProgress) {
          msg = await opts.messagesRepo.getProcessing(s.id).then((inProgress) =>
            inProgress
              ? {
                  ...inProgress,
                  content: RESUME_IN_PROGRESS_CONTENT,
                  resumeLastSession: true
                }
              : null
          );
        } else {
          msg = await opts.messagesRepo.claimNext(s.id);
          notifyProcessing = msg !== null;
        }
      }
      if (!msg) continue;
      if (notifyProcessing && opts.telegram.sendProcessing) {
        try {
          await opts.telegram.sendProcessing(s.chatId, msg.content, s.id);
        } catch {
          // Claiming work should not be undone or hidden from the daemon just
          // because this best-effort status notification failed.
        }
      }
      grouped.push({
        sessionId: s.id,
        profileName: profile.name,
        workDir: s.workDir ?? undefined,
        messages: [
          DaemonMessage.parse({
            id: msg.id,
            content: msg.content,
            kind: msg.kind,
            resumeLastSession: msg.resumeLastSession,
            codexReasoningEffort: msg.codexReasoningEffort,
            createdAt: msg.createdAt
          })
        ]
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
      await opts.telegram.sendResponse(session.chatId, body.content, session.id);
    } catch (e) {
      const mapped = toApiErrorIfPermanent(e);
      if (mapped) throw mapped;
      throw e;
    }
    const completed = await opts.messagesRepo.completeProcessing(session.id);
    if (completed && opts.telegram.sendProcessed) {
      try {
        await opts.telegram.sendProcessed(session.chatId, session.id);
      } catch {
        // The final response was delivered and the queue item was completed.
        // Do not make the daemon retry and duplicate the final response just
        // because the best-effort acknowledgement failed.
      }
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
