import { ADMIN_API_PATHS, AdminApiKey, AdminMessage, AdminProfile, AdminSession, EnqueueMessageBody, ListSessionsQuery, UpdateMessageBody } from "@chatcoder/shared";
function toAdminApiKey(a) {
    return AdminApiKey.parse({
        id: a.id,
        apiKeyPrefix: a.apiKeyPrefix,
        status: a.status,
        createdAt: a.createdAt,
        revokedAt: a.revokedAt,
        lastHeartbeat: a.lastHeartbeat
    });
}
function toAdminProfile(p) {
    return AdminProfile.parse({
        id: p.id,
        apiKeyId: p.apiKeyId,
        name: p.name,
        tool: p.tool,
        metadata: p.metadata,
        createdAt: p.createdAt
    });
}
function toAdminSession(j) {
    return AdminSession.parse({
        id: j.session.id,
        chatId: j.session.chatId,
        apiKeyId: j.session.apiKeyId,
        apiKeyPrefix: j.apiKey.apiKeyPrefix,
        apiKeyLastHeartbeat: j.apiKey.lastHeartbeat,
        profileId: j.session.profileId,
        profileName: j.profile.name,
        profileTool: j.profile.tool,
        status: j.session.status,
        createdAt: j.session.createdAt,
        revokedAt: j.session.revokedAt
    });
}
function toAdminMessage(m) {
    return AdminMessage.parse({
        id: m.id,
        sessionId: m.sessionId,
        content: m.content,
        resumeLastSession: m.resumeLastSession,
        processingStartedAt: m.processingStartedAt,
        createdAt: m.createdAt
    });
}
export function registerAdminRoutes(app, deps) {
    /* ---------- API keys ---------- */
    app.get(ADMIN_API_PATHS.apiKeys, async () => {
        const [keys, total] = await Promise.all([
            deps.apiKeys.list({}),
            deps.apiKeys.count({})
        ]);
        return {
            apiKeys: keys.map(toAdminApiKey),
            total
        };
    });
    app.get("/v1/admin/api-keys/:id", async (req, reply) => {
        const { id } = req.params;
        const key = await deps.apiKeys.getById(id);
        if (!key) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "API key not found" } });
            return;
        }
        const [profiles, sessions] = await Promise.all([
            deps.profiles.listByApiKey(id),
            deps.admin.listSessions({ apiKeyId: id })
        ]);
        return {
            apiKey: toAdminApiKey(key),
            profiles: profiles.map(toAdminProfile),
            sessions: sessions.map(toAdminSession)
        };
    });
    app.delete("/v1/admin/api-keys/:id", async (req, reply) => {
        const { id } = req.params;
        const ok = await deps.apiKeys.delete(id);
        if (!ok) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "API key not found" } });
            return;
        }
        return { ok: true };
    });
    app.post("/v1/admin/api-keys/:id/revoke", async (req, reply) => {
        const { id } = req.params;
        const existed = await deps.apiKeys.getById(id);
        if (!existed) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "API key not found" } });
            return;
        }
        await deps.apiKeys.revoke(id);
        return { ok: true };
    });
    /* ---------- Sessions ---------- */
    app.get(ADMIN_API_PATHS.sessions, async (req) => {
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
    app.get("/v1/admin/sessions/:id/detail", async (req, reply) => {
        const { id } = req.params;
        const s = await deps.admin.getSessionById(id);
        if (!s) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
            return;
        }
        const [messages, pending] = await Promise.all([
            deps.admin.listMessages(id),
            deps.messages.count(id)
        ]);
        return {
            session: toAdminSession(s),
            pending,
            messages: messages.map(toAdminMessage)
        };
    });
    app.delete("/v1/admin/sessions/:id", async (req, reply) => {
        const { id } = req.params;
        const ok = await deps.admin.deleteSession(id);
        if (!ok) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
            return;
        }
        return { ok: true };
    });
    app.post("/v1/admin/sessions/:id/revoke", async (req, reply) => {
        const { id } = req.params;
        const existed = await deps.admin.getSessionById(id);
        if (!existed) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
            return;
        }
        await deps.sessions.revoke(id);
        return { ok: true };
    });
    app.post("/v1/admin/sessions/:id/purge", async (req, reply) => {
        const { id } = req.params;
        const existed = await deps.admin.getSessionById(id);
        if (!existed) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
            return;
        }
        await deps.messages.purgeSession(id);
        return { ok: true };
    });
    /* ---------- Messages ---------- */
    app.get("/v1/admin/sessions/:id/messages", async (req) => {
        const { id } = req.params;
        const messages = await deps.admin.listMessages(id);
        return { messages: messages.map(toAdminMessage) };
    });
    app.post("/v1/admin/sessions/:id/messages", async (req, reply) => {
        const { id } = req.params;
        const existed = await deps.admin.getSessionById(id);
        if (!existed) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
            return;
        }
        const body = EnqueueMessageBody.parse(req.body ?? {});
        const { message, droppedOldestId } = await deps.messages.enqueue({
            sessionId: id,
            content: body.content,
            resumeLastSession: body.resumeLastSession
        });
        return {
            message: toAdminMessage(message),
            droppedOldestId
        };
    });
    app.get("/v1/admin/messages/:id", async (req, reply) => {
        const { id } = req.params;
        const m = await deps.admin.getMessageById(id);
        if (!m) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } });
            return;
        }
        return toAdminMessage(m);
    });
    app.patch("/v1/admin/messages/:id", async (req, reply) => {
        const { id } = req.params;
        const body = UpdateMessageBody.parse(req.body ?? {});
        const ok = await deps.admin.updateMessageContent(id, body.content);
        if (!ok) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } });
            return;
        }
        return { ok: true };
    });
    app.delete("/v1/admin/messages/:id", async (req, reply) => {
        const { id } = req.params;
        const ok = await deps.admin.deleteMessage(id);
        if (!ok) {
            reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found" } });
            return;
        }
        return { ok: true };
    });
}
//# sourceMappingURL=admin.js.map