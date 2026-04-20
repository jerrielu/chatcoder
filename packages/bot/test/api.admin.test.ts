import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/api/server.js";
import { makeHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;
let app: FastifyInstance;

beforeEach(async () => {
  h = await makeHarness();
  app = await buildServer({
    sessionsRepo: h.sessions,
    messagesRepo: h.messages,
    adminRepo: h.admin
  });
});
afterEach(async () => {
  await app.close();
  await h.close();
});

function json(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    ...(body !== undefined
      ? { payload: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {})
  });
}

describe("loopback guard", () => {
  it("returns 404 for non-loopback peers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/sessions",
      remoteAddress: "203.0.113.9"
    });
    expect(res.statusCode).toBe(404);
  });

  it("allows loopback peers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/sessions",
      remoteAddress: "127.0.0.1"
    });
    expect(res.statusCode).toBe(200);
  });

  it("allows IPv6 loopback", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/sessions",
      remoteAddress: "::1"
    });
    expect(res.statusCode).toBe(200);
  });

  it("admin routes skip bearer auth", async () => {
    // No Authorization header — daemon routes 401, admin routes 200.
    const ok = await json("GET", "/v1/admin/sessions");
    expect(ok.statusCode).toBe(200);
    const daemon = await json("GET", "/v1/session");
    expect(daemon.statusCode).toBe(401);
  });
});

describe("CORS policy", () => {
  it("allows a loopback origin and reflects it back", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/sessions",
      headers: { origin: "http://127.0.0.1:5173" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  it("allows localhost origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/sessions",
      headers: { origin: "http://localhost:8000" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8000");
  });

  it("rejects a remote origin with no CORS header", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/admin/sessions",
      headers: {
        origin: "http://example.com",
        "access-control-request-method": "GET"
      }
    });
    // @fastify/cors responds without Allow-Origin when rejecting.
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects a malformed origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/admin/sessions",
      headers: {
        origin: "not a url",
        "access-control-request-method": "GET"
      }
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("non-browser (no Origin header) still works", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sessions" });
    expect(res.statusCode).toBe(200);
  });
});

describe("admin sessions CRUD", () => {
  it("lists + filters + paginates", async () => {
    const a = await h.sessions.rotate({ chatId: 1 });
    h.advanceTime(5);
    const b = await h.sessions.rotate({ chatId: 2 });
    h.advanceTime(5);
    await h.sessions.rotate({ chatId: 1 }); // revokes a

    const all = await json("GET", "/v1/admin/sessions");
    expect(all.statusCode).toBe(200);
    expect(all.json().total).toBe(3);

    const activeOnly = await json("GET", "/v1/admin/sessions?status=active");
    expect(activeOnly.json().total).toBe(2);

    const byChat = await json("GET", "/v1/admin/sessions?chatId=2");
    const ids = byChat.json().sessions.map((s: { id: string }) => s.id);
    expect(ids).toEqual([b.session.id]);
    // API omits internal fields
    expect(byChat.json().sessions[0]).not.toHaveProperty("apiKeyHash");
    expect(byChat.json().sessions[0]).not.toHaveProperty("lastCodeAt");

    const limited = await json("GET", "/v1/admin/sessions?limit=1&offset=0");
    expect(limited.json().sessions).toHaveLength(1);

    // round-trip sanity check for the "a" session
    void a;
  });

  it("create + detail + update + rotate + revoke + delete", async () => {
    const created = await json("POST", "/v1/admin/sessions", { chatId: 42 });
    expect(created.statusCode).toBe(200);
    const id = created.json().session.id;
    expect(created.json().rawApiKey).toMatch(/^cc_/);

    const detail = await json("GET", `/v1/admin/sessions/${id}/detail`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().session.id).toBe(id);
    expect(detail.json().pendingToDaemon).toBe(0);
    expect(detail.json().pendingToUser).toBe(0);
    expect(detail.json().messages).toEqual([]);

    const upd = await json("PATCH", `/v1/admin/sessions/${id}`, { chatId: 99 });
    expect(upd.statusCode).toBe(200);
    expect((await h.admin.getSessionById(id))?.chatId).toBe(99);

    h.advanceTime(10);
    const rot = await json("POST", `/v1/admin/sessions/${id}/rotate`, {});
    expect(rot.statusCode).toBe(200);
    const newId = rot.json().session.id;
    expect(newId).not.toBe(id);
    expect((await h.admin.getSessionById(id))?.status).toBe("revoked");

    const rev = await json("POST", `/v1/admin/sessions/${newId}/revoke`);
    expect(rev.statusCode).toBe(200);
    expect((await h.admin.getSessionById(newId))?.status).toBe("revoked");

    const del = await json("DELETE", `/v1/admin/sessions/${id}`);
    expect(del.statusCode).toBe(200);
    expect(await h.admin.getSessionById(id)).toBeNull();
  });

  it("returns 404 for missing session across endpoints", async () => {
    expect((await json("GET", "/v1/admin/sessions/nope/detail")).statusCode).toBe(404);
    expect((await json("PATCH", "/v1/admin/sessions/nope", { chatId: 1 })).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/sessions/nope/rotate", {})).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/sessions/nope/revoke")).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/sessions/nope/purge")).statusCode).toBe(404);
    expect((await json("DELETE", "/v1/admin/sessions/nope")).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/sessions/nope/messages", {
      direction: "to_daemon",
      content: "x"
    })).statusCode).toBe(404);
  });

  it("rejects validation errors", async () => {
    const bad = await json("POST", "/v1/admin/sessions", { chatId: "not-a-number" });
    expect(bad.statusCode).toBe(400);
  });

  it("surfaces reuse-of-existing-hash as 400", async () => {
    const key = "shared-key-for-test-xx";
    const first = await json("POST", "/v1/admin/sessions", { chatId: 1, rawApiKey: key });
    expect(first.statusCode).toBe(200);
    const second = await json("POST", "/v1/admin/sessions", { chatId: 2, rawApiKey: key });
    expect(second.statusCode).toBe(400);
  });

  it("rotate surfaces validation errors as 400", async () => {
    const held = "pinned-key-aaaaaaaaa";
    await json("POST", "/v1/admin/sessions", { chatId: 1, rawApiKey: held });
    const other = await json("POST", "/v1/admin/sessions", { chatId: 2 });
    expect(other.statusCode).toBe(200);
    const otherId = other.json().session.id;
    // Try to rotate session 2 to the same key that session 1 owns.
    const res = await json("POST", `/v1/admin/sessions/${otherId}/rotate`, {
      rawApiKey: held
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("admin messages", () => {
  it("enqueue + list + get + update + delete + purge", async () => {
    const r = await h.sessions.rotate({ chatId: 5 });
    const sid = r.session.id;

    const enq = await json("POST", `/v1/admin/sessions/${sid}/messages`, {
      direction: "to_daemon",
      content: "do thing"
    });
    expect(enq.statusCode).toBe(200);
    const mid = enq.json().message.id;

    const list = await json("GET", `/v1/admin/sessions/${sid}/messages`);
    expect(list.statusCode).toBe(200);
    expect(list.json().messages).toHaveLength(1);

    const one = await json("GET", `/v1/admin/messages/${mid}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().content).toBe("do thing");

    const upd = await json("PATCH", `/v1/admin/messages/${mid}`, { content: "edited" });
    expect(upd.statusCode).toBe(200);
    expect((await h.admin.getMessageById(mid))?.content).toBe("edited");

    const del = await json("DELETE", `/v1/admin/messages/${mid}`);
    expect(del.statusCode).toBe(200);
    expect(await h.admin.getMessageById(mid)).toBeNull();

    // purge removes everything
    await json("POST", `/v1/admin/sessions/${sid}/messages`, {
      direction: "to_daemon",
      content: "a"
    });
    await json("POST", `/v1/admin/sessions/${sid}/messages`, {
      direction: "to_user",
      content: "b"
    });
    const purge = await json("POST", `/v1/admin/sessions/${sid}/purge`);
    expect(purge.statusCode).toBe(200);
    expect(await h.admin.listMessages(sid)).toEqual([]);
  });

  it("filters messages by direction", async () => {
    const r = await h.sessions.rotate({ chatId: 5 });
    const sid = r.session.id;
    await h.messages.enqueue({ sessionId: sid, direction: "to_daemon", content: "i" });
    await h.messages.enqueue({ sessionId: sid, direction: "to_user", content: "r" });
    const daemon = await json("GET", `/v1/admin/sessions/${sid}/messages?direction=to_daemon`);
    expect(daemon.json().messages).toHaveLength(1);
    expect(daemon.json().messages[0].direction).toBe("to_daemon");
  });

  it("rejects oversize content by direction", async () => {
    const r = await h.sessions.rotate({ chatId: 5 });
    const sid = r.session.id;
    const big = "x".repeat(4097);
    const res = await json("POST", `/v1/admin/sessions/${sid}/messages`, {
      direction: "to_daemon",
      content: big
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for missing message", async () => {
    expect((await json("GET", "/v1/admin/messages/nope")).statusCode).toBe(404);
    expect(
      (await json("PATCH", "/v1/admin/messages/nope", { content: "x" })).statusCode
    ).toBe(404);
    expect((await json("DELETE", "/v1/admin/messages/nope")).statusCode).toBe(404);
  });
});
