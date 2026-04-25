import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as api from "../src/api/client";
import { ApiClientError } from "../src/api/client";
import { BOT_API_URL } from "../src/config";

interface StubCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: StubCall[];
let responder: (call: StubCall) => { status: number; body?: unknown };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  responder = () => {
    throw new Error("responder not installed");
  };
  globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const typedInit = init as { method?: string; body?: string } | undefined;
    const method = typedInit?.method ?? "GET";
    const bodyStr = typedInit?.body;
    const body =
      typeof bodyStr === "string" && bodyStr.length > 0 ? JSON.parse(bodyStr) : undefined;
    const call: StubCall = { url, method, body };
    calls.push(call);
    const { status, body: out } = responder(call);
    const text = out === undefined ? "" : JSON.stringify(out);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const sampleSession = {
  id: "s1",
  chatId: 42,
  apiKeyId: "a1",
  apiKeyPrefix: "cc_abcd",
  apiKeyLastHeartbeat: null,
  profileId: "p1",
  profileName: "main",
  profileTool: "CLAUDE_CODE" as const,
  status: "active" as const,
  createdAt: 0,
  revokedAt: null
};

describe("listSessions", () => {
  it("serialises filter into query string and parses the envelope", async () => {
    responder = (call) => {
      expect(call.url).toBe(
        `${BOT_API_URL}/v1/admin/sessions?status=active&chatId=42&limit=10&offset=0`
      );
      expect(call.method).toBe("GET");
      return { status: 200, body: { sessions: [], total: 0 } };
    };
    const out = await api.listSessions({
      status: "active",
      chatId: 42,
      limit: 10,
      offset: 0
    });
    expect(out.total).toBe(0);
  });

  it("adds apiKeyId to the query when supplied", async () => {
    responder = (call) => {
      expect(call.url).toBe(`${BOT_API_URL}/v1/admin/sessions?apiKeyId=a1`);
      return { status: 200, body: { sessions: [], total: 0 } };
    };
    await api.listSessions({ apiKeyId: "a1" });
  });

  it("omits undefined query params", async () => {
    responder = (call) => {
      expect(call.url).toBe(`${BOT_API_URL}/v1/admin/sessions`);
      return { status: 200, body: { sessions: [], total: 0 } };
    };
    await api.listSessions({});
  });

  it("throws ApiClientError on non-2xx", async () => {
    responder = () => ({
      status: 500,
      body: { error: { code: "INTERNAL", message: "boom" } }
    });
    await expect(api.listSessions({})).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("api-keys endpoints", () => {
  it("listApiKeys parses envelope", async () => {
    responder = () => ({
      status: 200,
      body: {
        apiKeys: [
          {
            id: "a1",
            apiKeyPrefix: "cc_abcd",
            status: "active",
            createdAt: 0,
            revokedAt: null,
            lastHeartbeat: null
          }
        ],
        total: 1
      }
    });
    const out = await api.listApiKeys();
    expect(out.total).toBe(1);
  });

  it("getApiKeyDetail returns null on 404 and envelope on 200", async () => {
    responder = () => ({ status: 404, body: {} });
    expect(await api.getApiKeyDetail("nope")).toBeNull();

    responder = () => ({
      status: 200,
      body: {
        apiKey: {
          id: "a1",
          apiKeyPrefix: "cc_abcd",
          status: "active",
          createdAt: 0,
          revokedAt: null,
          lastHeartbeat: null
        },
        profiles: [],
        sessions: []
      }
    });
    const out = await api.getApiKeyDetail("a1");
    expect(out?.apiKey.id).toBe("a1");
  });

  it("revokeApiKey / deleteApiKey booleans", async () => {
    responder = () => ({ status: 200, body: { ok: true } });
    expect(await api.revokeApiKey("a1")).toBe(true);
    expect(await api.deleteApiKey("a1")).toBe(true);
    responder = () => ({ status: 404, body: {} });
    expect(await api.revokeApiKey("a1")).toBe(false);
    expect(await api.deleteApiKey("a1")).toBe(false);
  });
});

describe("getSessionDetail", () => {
  it("returns null on 404", async () => {
    responder = () => ({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "no" } }
    });
    const out = await api.getSessionDetail("nope");
    expect(out).toBeNull();
  });

  it("parses detail envelope on 200", async () => {
    responder = () => ({
      status: 200,
      body: {
        session: sampleSession,
        pending: 2,
        messages: []
      }
    });
    const out = await api.getSessionDetail("s1");
    expect(out?.pending).toBe(2);
  });

  it("throws on 500", async () => {
    responder = () => ({
      status: 500,
      body: { error: { code: "INTERNAL", message: "boom" } }
    });
    await expect(api.getSessionDetail("s1")).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("session mutation endpoints", () => {
  it("revokeSession + deleteSession + purgeSession all boolean", async () => {
    responder = () => ({ status: 200, body: { ok: true } });
    expect(await api.revokeSession("s1")).toBe(true);
    expect(await api.deleteSession("s1")).toBe(true);
    expect(await api.purgeSession("s1")).toBe(true);

    responder = () => ({ status: 404, body: { error: { code: "NOT_FOUND", message: "" } } });
    expect(await api.revokeSession("s1")).toBe(false);
    expect(await api.deleteSession("s1")).toBe(false);
    expect(await api.purgeSession("s1")).toBe(false);
  });

  it("deleteSession surfaces non-2xx/404 as ApiClientError", async () => {
    responder = () => ({
      status: 500,
      body: { error: { code: "INTERNAL", message: "boom" } }
    });
    await expect(api.deleteSession("s1")).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("message endpoints", () => {
  it("listMessages returns parsed list", async () => {
    responder = () => ({ status: 200, body: { messages: [] } });
    expect((await api.listMessages("s1")).messages).toEqual([]);
  });

  it("enqueueMessage returns null on 404 and envelope on 200", async () => {
    responder = () => ({ status: 404, body: {} });
    expect(await api.enqueueMessage("s1", { content: "x" })).toBeNull();

    responder = () => ({
      status: 200,
      body: {
        message: { id: "m1", sessionId: "s1", content: "x", createdAt: 1 },
        droppedOldestId: null
      }
    });
    const out = await api.enqueueMessage("s1", { content: "x" });
    expect(out?.message.id).toBe("m1");
  });

  it("getMessage returns null on 404 and envelope on 200", async () => {
    responder = () => ({ status: 404, body: {} });
    expect(await api.getMessage("nope")).toBeNull();

    responder = () => ({
      status: 200,
      body: { id: "m1", sessionId: "s1", content: "hi", createdAt: 1 }
    });
    const m = await api.getMessage("m1");
    expect(m?.content).toBe("hi");
  });

  it("updateMessage + deleteMessage boolean", async () => {
    responder = () => ({ status: 200, body: { ok: true } });
    expect(await api.updateMessage("m1", { content: "hi" })).toBe(true);
    expect(await api.deleteMessage("m1")).toBe(true);

    responder = () => ({ status: 404, body: {} });
    expect(await api.updateMessage("m1", { content: "hi" })).toBe(false);
    expect(await api.deleteMessage("m1")).toBe(false);
  });
});

describe("transport details", () => {
  it("passes method+path for DELETE", async () => {
    responder = (call) => {
      expect(call.method).toBe("DELETE");
      expect(call.url).toBe(`${BOT_API_URL}/v1/admin/sessions/s1`);
      return { status: 200, body: { ok: true } };
    };
    await api.deleteSession("s1");
  });

  it("ApiClientError carries status + code", async () => {
    responder = () => ({
      status: 403,
      body: { error: { code: "UNAUTHORIZED", message: "nope" } }
    });
    try {
      await api.listSessions({});
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as ApiClientError;
      expect(err).toBeInstanceOf(ApiClientError);
      expect(err.status).toBe(403);
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.message).toBe("nope");
    }
  });

  it("ApiClientError falls back when envelope is malformed", async () => {
    responder = () => ({ status: 500, body: "not-an-object" });
    try {
      await api.listSessions({});
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as ApiClientError;
      expect(err.code).toBe("UNKNOWN");
    }
  });

  it("records each request's URL + method", async () => {
    responder = () => ({ status: 200, body: { ok: true } });
    await api.revokeSession("s1");
    await api.deleteSession("s1");
    expect(calls.map((c) => c.method)).toEqual(["POST", "DELETE"]);
  });
});
