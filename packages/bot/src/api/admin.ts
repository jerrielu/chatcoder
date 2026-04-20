import type { FastifyInstance } from "fastify";
import {
  ADMIN_API_PATHS,
  AdminMessage,
  AdminSession,
  CreateSessionBody,
  CreateSessionResponse,
  EnqueueMessageBody,
  EnqueueMessageResponse,
  ListMessagesQuery,
  ListMessagesResponse,
  ListSessionsQuery,
  ListSessionsResponse,
  RotateSessionBody,
  SessionDetailResponse,
  UpdateMessageBody,
  UpdateSessionBody
} from "@chatcoder/shared";
import type { AdminRepo } from "../db/admin.js";
import type { MessagesRepo } from "../db/messages.js";
import type { Session, SessionsRepo } from "../db/sessions.js";
import type { QueuedMessage } from "../db/messages.js";

export interface AdminRoutesDeps {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  admin: AdminRepo;
}

function toAdminSession(s: Session): AdminSession {
  return AdminSession.parse({
    id: s.id,
    chatId: s.chatId,
    apiKeyPrefix: s.apiKeyPrefix,
    status: s.status,
    createdAt: s.createdAt,
    revokedAt: s.revokedAt,
    lastHeartbeat: s.lastHeartbeat
  });
}

function toAdminMessage(m: QueuedMessage): AdminMessage {
  return AdminMessage.parse({
    id: m.id,
    sessionId: m.sessionId,
    direction: m.direction,
    content: m.content,
    createdAt: m.createdAt
  });
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRoutesDeps): void {
  /* ---------- Sessions ---------- */

  app.get(ADMIN_API_PATHS.sessions, async (req): Promise<ListSessionsResponse> => {
    const filter = ListSessionsQuery.parse(req.query ?? {});
    const [sessions, total] = await Promise.all([
      deps.admin.listSessions(filter),
      deps.admin.countSessions(filter)
    ]);
    return {
      sessions: sessions.map(toAdminSession),
      total
    };
  });

  app.post(ADMIN_API_PATHS.sessions, async (req, reply): Promise<CreateSessionResponse | void> => {
    const body = CreateSessionBody.parse(req.body ?? {});
    try {
      const { session, rawApiKey } = await deps.sessions.rotate({
        chatId: body.chatId,
        ...(body.rawApiKey ? { rawApiKey: body.rawApiKey } : {})
      });
      return { session: toAdminSession(session), rawApiKey };
    } catch (err) {
      reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: (err as Error).message
        }
      });
    }
  });

  app.get(
    "/v1/admin/sessions/:id/detail",
    async (req, reply): Promise<SessionDetailResponse | void> => {
      const { id } = req.params as { id: string };
      const s = await deps.admin.getSessionById(id);
      if (!s) {
        reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
        return;
      }
      const [messages, pendingToDaemon, pendingToUser] = await Promise.all([
        deps.admin.listMessages(id),
        deps.messages.count(id, "to_daemon"),
        deps.messages.count(id, "to_user")
      ]);
      return {
        session: toAdminSession(s),
        pendingToDaemon,
        pendingToUser,
        messages: messages.map(toAdminMessage)
      };
    }
  );

  app.patch("/v1/admin/sessions/:id", async (req, reply): Promise<{ ok: true } | void> => {
    const { id } = req.params as { id: string };
    const body = UpdateSessionBody.parse(req.body ?? {});
    const ok = await deps.admin.updateSession(id, { chatId: body.chatId });
    if (!ok) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }
    return { ok: true };
  });

  app.delete("/v1/admin/sessions/:id", async (req, reply): Promise<{ ok: true } | void> => {
    const { id } = req.params as { id: string };
    const ok = await deps.admin.deleteSession(id);
    if (!ok) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }
    return { ok: true };
  });

  app.post(
    "/v1/admin/sessions/:id/rotate",
    async (req, reply): Promise<CreateSessionResponse | void> => {
      const { id } = req.params as { id: string };
      const existing = await deps.admin.getSessionById(id);
      if (!existing) {
        reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
        return;
      }
      const body = RotateSessionBody.parse(req.body ?? {});
      try {
        const { session, rawApiKey } = await deps.sessions.rotate({
          chatId: existing.chatId,
          ...(body.rawApiKey ? { rawApiKey: body.rawApiKey } : {})
        });
        return { session: toAdminSession(session), rawApiKey };
      } catch (err) {
        reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: (err as Error).message
          }
        });
      }
    }
  );

  app.post("/v1/admin/sessions/:id/revoke", async (req, reply): Promise<{ ok: true } | void> => {
    const { id } = req.params as { id: string };
    const existed = await deps.admin.getSessionById(id);
    if (!existed) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }
    await deps.admin.revokeSession(id);
    return { ok: true };
  });

  app.post("/v1/admin/sessions/:id/purge", async (req, reply): Promise<{ ok: true } | void> => {
    const { id } = req.params as { id: string };
    const existed = await deps.admin.getSessionById(id);
    if (!existed) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
      return;
    }
    await deps.messages.purgeSession(id);
    return { ok: true };
  });

  /* ---------- Messages ---------- */

  app.get(
    "/v1/admin/sessions/:id/messages",
    async (req): Promise<ListMessagesResponse> => {
      const { id } = req.params as { id: string };
      const q = ListMessagesQuery.parse(req.query ?? {});
      const messages = await deps.admin.listMessages(id, q.direction);
      return { messages: messages.map(toAdminMessage) };
    }
  );

  app.post(
    "/v1/admin/sessions/:id/messages",
    async (req, reply): Promise<EnqueueMessageResponse | void> => {
      const { id } = req.params as { id: string };
      const existed = await deps.admin.getSessionById(id);
      if (!existed) {
        reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
        return;
      }
      const body = EnqueueMessageBody.parse(req.body ?? {});
      const { message, droppedOldestId } = await deps.messages.enqueue({
        sessionId: id,
        direction: body.direction,
        content: body.content
      });
      return {
        message: toAdminMessage(message),
        droppedOldestId
      };
    }
  );

  app.get("/v1/admin/messages/:id", async (req, reply): Promise<AdminMessage | void> => {
    const { id } = req.params as { id: string };
    const m = await deps.admin.getMessageById(id);
    if (!m) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } });
      return;
    }
    return toAdminMessage(m);
  });

  app.patch("/v1/admin/messages/:id", async (req, reply): Promise<{ ok: true } | void> => {
    const { id } = req.params as { id: string };
    const body = UpdateMessageBody.parse(req.body ?? {});
    const ok = await deps.admin.updateMessageContent(id, body.content);
    if (!ok) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } });
      return;
    }
    return { ok: true };
  });

  app.delete("/v1/admin/messages/:id", async (req, reply): Promise<{ ok: true } | void> => {
    const { id } = req.params as { id: string };
    const ok = await deps.admin.deleteMessage(id);
    if (!ok) {
      reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } });
      return;
    }
    return { ok: true };
  });
}
