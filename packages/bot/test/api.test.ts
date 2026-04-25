import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../src/api/server.js";
import { makeHarness, type TestHarness } from "./helpers.js";
import { MAX_RESPONSE_BYTES } from "@chatcoder/shared";
import { generateApiKey } from "../src/db/crypto.js";
import type { FastifyInstance } from "fastify";

let h: TestHarness;
let app: FastifyInstance;
let rawApiKey: string;
let apiKeyId: string;
let profileId: string;
let sessionId: string;
let sendResponse: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  h = await makeHarness();
  const seed = await h.seedSession({ chatId: 42 });
  rawApiKey = seed.rawApiKey;
  apiKeyId = seed.apiKey.id;
  profileId = seed.profile.id;
  sessionId = seed.session.id;
  sendResponse = vi.fn().mockResolvedValue(undefined);
  app = await buildServer({
    apiKeysRepo: h.apiKeys,
    profilesRepo: h.profiles,
    sessionsRepo: h.sessions,
    messagesRepo: h.messages,
    adminRepo: h.admin,
    telegram: { sendResponse }
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
    const res = await app.inject({ method: "GET", url: "/v1/poll" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("401 with wrong bearer", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/poll",
      headers: { authorization: "Bearer wrong" }
    });
    expect(res.statusCode).toBe(401);
  });

  it("410 SESSION_REVOKED when api key revoked", async () => {
    await h.apiKeys.revoke(apiKeyId);
    const res = await app.inject({
      method: "GET",
      url: "/v1/poll",
      headers: auth()
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("SESSION_REVOKED");
  });

  it("lets non-v1 paths through", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /v1/daemon/register", () => {
  it("creates api_key + profiles on first call and upserts on subsequent calls", async () => {
    const { rawApiKey: fresh } = generateApiKey();
    const res = await app.inject({
      method: "POST",
      url: "/v1/daemon/register",
      headers: { authorization: `Bearer ${fresh}` },
      payload: {
        profiles: [
          { name: "main", tool: "CLAUDE_CODE" },
          { name: "ops", tool: "OPENAI", metadata: "server" }
        ]
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profiles).toHaveLength(2);

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/daemon/register",
      headers: { authorization: `Bearer ${fresh}` },
      payload: {
        profiles: [{ name: "main", tool: "CLAUDE_CODE" }]
      }
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().profiles).toHaveLength(1);
  });

  it("rejects too-short keys with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/daemon/register",
      headers: { authorization: "Bearer short" },
      payload: { profiles: [] }
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/heartbeat", () => {
  it("updates api_key last_heartbeat", async () => {
    h.advanceTime(500);
    const res = await app.inject({
      method: "POST",
      url: "/v1/heartbeat",
      headers: auth(),
      payload: { note: "alive" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const fresh = await h.apiKeys.getById(apiKeyId);
    expect(fresh?.lastHeartbeat).toBe(h.now());
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
  it("returns grouped sessions with drained messages", async () => {
    await h.messages.enqueue({ sessionId, content: "do a" });
    await h.messages.enqueue({ sessionId, content: "do b" });
    const res = await app.inject({ method: "GET", url: "/v1/poll", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reset).toBe(false);
    expect(body.sessions).toHaveLength(1);
    const [group] = body.sessions;
    expect(group.sessionId).toBe(sessionId);
    expect(group.profileName).toBe("main");
    expect(group.messages.map((m: { content: string }) => m.content)).toEqual([
      "do a",
      "do b"
    ]);
    expect(group.messages.map((m: { resumeLastSession: boolean }) => m.resumeLastSession)).toEqual([
      true,
      true
    ]);

    // Drained on second poll
    const again = await app.inject({ method: "GET", url: "/v1/poll", headers: auth() });
    expect(again.json().sessions).toEqual([]);
  });

  it("groups per profile when api_key has multiple sessions", async () => {
    const [, profB] = await h.profiles.upsertForApiKey(apiKeyId, [
      { name: "main", tool: "CLAUDE_CODE" },
      { name: "ops", tool: "OPENAI" }
    ]);
    const sessionB = await h.sessions.create({
      chatId: 43,
      apiKeyId,
      profileId: profB!.id
    });
    await h.messages.enqueue({ sessionId, content: "for-main" });
    await h.messages.enqueue({ sessionId: sessionB.id, content: "for-ops" });
    const res = await app.inject({ method: "GET", url: "/v1/poll", headers: auth() });
    const groups = res.json().sessions as Array<{
      profileName: string;
      messages: Array<{ content: string }>;
    }>;
    expect(groups.map((g) => g.profileName).sort()).toEqual(["main", "ops"]);
    const byName = new Map(groups.map((g) => [g.profileName, g.messages]));
    expect(byName.get("main")![0]!.content).toBe("for-main");
    expect(byName.get("ops")![0]!.content).toBe("for-ops");
  });

  void profileId;
});

describe("POST /v1/responses", () => {
  it("forwards to Telegram with the session's chat id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { sessionId, content: "hello world" }
    });
    expect(res.statusCode).toBe(200);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith(42, "hello world");
  });

  it("stores non-final responses as latest progress without sending Telegram", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { sessionId, content: "working...", final: false }
    });
    expect(res.statusCode).toBe(200);
    expect(sendResponse).not.toHaveBeenCalled();
    const session = await h.sessions.getById(sessionId);
    expect(session?.latestMessage).toBe("working...");
  });

  it("rejects >MAX_RESPONSE_BYTES", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { sessionId, content: "x".repeat(MAX_RESPONSE_BYTES + 1) }
    });
    expect(res.statusCode).toBe(400);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("rejects missing sessionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { content: "hi" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects foreign sessionId", async () => {
    const other = await h.seedSession({ chatId: 99, profileName: "other" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { sessionId: other.session.id, content: "hi" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 VALIDATION_ERROR when Telegram rejects permanently", async () => {
    sendResponse.mockRejectedValueOnce({
      error_code: 403,
      description: "Forbidden: bot was blocked by the user"
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { sessionId, content: "hi" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 when Telegram fails transiently", async () => {
    sendResponse.mockRejectedValueOnce(new Error("network down"));
    const res = await app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: auth(),
      payload: { sessionId, content: "hi" }
    });
    expect(res.statusCode).toBe(500);
  });
});
