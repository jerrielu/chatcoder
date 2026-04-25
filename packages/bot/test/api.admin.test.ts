import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/api/server.js";
import { makeHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;
let app: FastifyInstance;

beforeEach(async () => {
  h = await makeHarness();
  app = await buildServer({
    apiKeysRepo: h.apiKeys,
    profilesRepo: h.profiles,
    sessionsRepo: h.sessions,
    messagesRepo: h.messages,
    adminRepo: h.admin,
    telegram: { sendResponse: vi.fn().mockResolvedValue(undefined) }
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
    const ok = await json("GET", "/v1/admin/sessions");
    expect(ok.statusCode).toBe(200);
    const daemon = await json("GET", "/v1/poll");
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
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("non-browser (no Origin header) still works", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sessions" });
    expect(res.statusCode).toBe(200);
  });
});

describe("admin api-keys endpoints", () => {
  it("lists, fetches detail, revokes, deletes", async () => {
    const seed = await h.seedSession({ chatId: 1, profileName: "main" });
    const list = await json("GET", "/v1/admin/api-keys");
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().apiKeys[0].apiKeyPrefix).toBe(seed.apiKey.apiKeyPrefix);

    const detail = await json("GET", `/v1/admin/api-keys/${seed.apiKey.id}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.profiles).toHaveLength(1);
    expect(body.sessions).toHaveLength(1);

    const rev = await json("POST", `/v1/admin/api-keys/${seed.apiKey.id}/revoke`);
    expect(rev.statusCode).toBe(200);
    expect((await h.apiKeys.getById(seed.apiKey.id))?.status).toBe("revoked");

    const del = await json("DELETE", `/v1/admin/api-keys/${seed.apiKey.id}`);
    expect(del.statusCode).toBe(200);
    expect(await h.apiKeys.getById(seed.apiKey.id)).toBeNull();
  });

  it("returns 404 on missing api-key", async () => {
    expect((await json("GET", "/v1/admin/api-keys/nope")).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/api-keys/nope/revoke")).statusCode).toBe(404);
    expect((await json("DELETE", "/v1/admin/api-keys/nope")).statusCode).toBe(404);
  });
});

describe("admin sessions CRUD", () => {
  it("lists + filters + paginates", async () => {
    await h.seedSession({ chatId: 1, profileName: "p-a" });
    h.advanceTime(5);
    const b = await h.seedSession({ chatId: 2, profileName: "p-b" });
    h.advanceTime(5);
    await h.seedSession({ chatId: 1, profileName: "p-c" });

    const all = await json("GET", "/v1/admin/sessions");
    expect(all.statusCode).toBe(200);
    expect(all.json().total).toBe(3);

    const byChat = await json("GET", "/v1/admin/sessions?chatId=2");
    const ids = byChat.json().sessions.map((s: { id: string }) => s.id);
    expect(ids).toEqual([b.session.id]);
    expect(byChat.json().sessions[0]).not.toHaveProperty("apiKeyHash");

    const limited = await json("GET", "/v1/admin/sessions?limit=1&offset=0");
    expect(limited.json().sessions).toHaveLength(1);
  });

  it("detail + revoke + delete", async () => {
    const seed = await h.seedSession({ chatId: 5 });
    const id = seed.session.id;

    const detail = await json("GET", `/v1/admin/sessions/${id}/detail`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().session.id).toBe(id);
    expect(detail.json().pending).toBe(0);

    const rev = await json("POST", `/v1/admin/sessions/${id}/revoke`);
    expect(rev.statusCode).toBe(200);
    const after = await h.admin.getSessionById(id);
    expect(after?.session.status).toBe("revoked");

    const del = await json("DELETE", `/v1/admin/sessions/${id}`);
    expect(del.statusCode).toBe(200);
    expect(await h.admin.getSessionById(id)).toBeNull();
  });

  it("returns 404 for missing session across endpoints", async () => {
    expect((await json("GET", "/v1/admin/sessions/nope/detail")).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/sessions/nope/revoke")).statusCode).toBe(404);
    expect((await json("POST", "/v1/admin/sessions/nope/purge")).statusCode).toBe(404);
    expect((await json("DELETE", "/v1/admin/sessions/nope")).statusCode).toBe(404);
    expect(
      (await json("POST", "/v1/admin/sessions/nope/messages", { content: "x" })).statusCode
    ).toBe(404);
  });
});

describe("admin messages", () => {
  it("enqueue + list + get + update + delete + purge", async () => {
    const seed = await h.seedSession({ chatId: 5 });
    const sid = seed.session.id;

    const enq = await json("POST", `/v1/admin/sessions/${sid}/messages`, {
      content: "do thing"
    });
    expect(enq.statusCode).toBe(200);
    const mid = enq.json().message.id;
    expect(enq.json().message.processingStartedAt).toBeNull();

    const list = await json("GET", `/v1/admin/sessions/${sid}/messages`);
    expect(list.statusCode).toBe(200);
    expect(list.json().messages).toHaveLength(1);

    await h.messages.claimNext(sid);
    const processingList = await json("GET", `/v1/admin/sessions/${sid}/messages`);
    expect(processingList.json().messages[0].processingStartedAt).toBe(h.now());

    const one = await json("GET", `/v1/admin/messages/${mid}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().content).toBe("do thing");
    expect(one.json().processingStartedAt).toBe(h.now());

    const upd = await json("PATCH", `/v1/admin/messages/${mid}`, { content: "edited" });
    expect(upd.statusCode).toBe(200);
    expect((await h.admin.getMessageById(mid))?.content).toBe("edited");

    const del = await json("DELETE", `/v1/admin/messages/${mid}`);
    expect(del.statusCode).toBe(200);
    expect(await h.admin.getMessageById(mid)).toBeNull();

    await json("POST", `/v1/admin/sessions/${sid}/messages`, { content: "a" });
    await json("POST", `/v1/admin/sessions/${sid}/messages`, { content: "b" });
    const purge = await json("POST", `/v1/admin/sessions/${sid}/purge`);
    expect(purge.statusCode).toBe(200);
    expect(await h.admin.listMessages(sid)).toEqual([]);
  });

  it("rejects oversize content", async () => {
    const seed = await h.seedSession({ chatId: 5 });
    const big = "x".repeat(4097);
    const res = await json("POST", `/v1/admin/sessions/${seed.session.id}/messages`, {
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
