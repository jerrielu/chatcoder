import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../src/api/server.js";
import { makeHarness, type TestHarness } from "./helpers.js";
import { MAX_RESPONSE_BYTES } from "@chatcoder/shared";
import type { FastifyInstance } from "fastify";

let h: TestHarness;
let app: FastifyInstance;
let rawApiKey: string;
let sessionId: string;

beforeEach(async () => {
  h = await makeHarness();
  const r = await h.sessions.rotate({ chatId: 42 });
  rawApiKey = r.rawApiKey;
  sessionId = r.session.id;
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

function auth(): Record<string, string> {
  return { authorization: `Bearer ${rawApiKey}` };
}

describe("auth plugin", () => {
  it("401 without bearer", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/session" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("401 with wrong bearer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { authorization: "Bearer wrong" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("410 SESSION_REVOKED after rotation", async () => {
    h.advanceTime(1);
    await h.sessions.rotate({ chatId: 42 }); // revokes previous
    const res = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: auth()
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("SESSION_REVOKED");
  });

  it("accepts non-v1 paths without auth", async () => {
    // There is no non-v1 route in production but the auth hook must not
    // block other paths if they ever exist. We test by hitting a missing path.
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/heartbeat", () => {
  it("updates last_heartbeat", async () => {
    h.advanceTime(500);
    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: auth(),
      payload: { note: "alive" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const s = await h.sessions.getByApiKeyHash((await h.sessions.getActiveByChatId(42))!.apiKeyHash);
    expect(s?.lastHeartbeat).toBe(h.now());
  });

  it("rejects malformed body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: auth(),
      payload: { note: "x".repeat(1000) }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/poll", () => {
  it("drains pending to_daemon messages", async () => {
    await h.messages.enqueue({ sessionId, direction: "to_daemon", content: "do a" });
    await h.messages.enqueue({ sessionId, direction: "to_daemon", content: "do b" });
    const res = await app.inject({ method: "GET", url: "/v1/poll", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(["do a", "do b"]);
    expect(body.reset).toBe(false);
    expect(body.sessionValid).toBe(true);
    // Drained:
    const again = await app.inject({ method: "GET", url: "/v1/poll", headers: auth() });
    expect(again.json().messages).toEqual([]);
  });
});

describe("POST /v1/responses", () => {
  it("enqueues response for user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { content: "hello world" }
    });
    expect(res.statusCode).toBe(200);
    expect(await h.messages.count(sessionId, "to_user")).toBe(1);
  });

  it("rejects >MAX_RESPONSE_BYTES", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { content: "x".repeat(MAX_RESPONSE_BYTES + 1) }
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing content", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/session", () => {
  it("returns the session snapshot", async () => {
    await h.messages.enqueue({ sessionId, direction: "to_daemon", content: "a" });
    await h.messages.enqueue({ sessionId, direction: "to_user", content: "b" });
    const res = await app.inject({ method: "GET", url: "/v1/session", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.pendingInstructions).toBe(1);
    expect(body.pendingResponses).toBe(1);
  });
});
