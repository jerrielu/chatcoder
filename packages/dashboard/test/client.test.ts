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

describe("listSessions", () => {
  it("serialises filter into query string and parses the envelope", async () => {
    responder = (call) => {
      expect(call.url).toBe(
        `${BOT_API_URL}/v1/admin/sessions?status=active&chatId=42&limit=10&offset=0`
      );
      expect(call.method).toBe("GET");
      return {
        status: 200,
        body: { sessions: [], total: 0 }
      };
    };
    const out = await api.listSessions({
      status: "active",
      chatId: 42,
      limit: 10,
      offset: 0
    });
    expect(out.total).toBe(0);
    expect(out.sessions).toEqual([]);
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

describe("createSession", () => {
  it("POSTs JSON body and parses envelope", async () => {
    responder = (call) => {
      expect(call.method).toBe("POST");
      expect(call.body).toEqual({ chatId: 7, rawApiKey: "some-key" });
      return {
        status: 200,
        body: {
          session: {
            id: "s1",
            chatId: 7,
            apiKeyPrefix: "cc_abcd",
            status: "active",
            createdAt: 0,
            revokedAt: null,
            lastHeartbeat: null
          },
          rawApiKey: "some-key"
        }
      };
    };
    const out = await api.createSession({ chatId: 7, rawApiKey: "some-key" });
    expect(out.rawApiKey).toBe("some-key");
    expect(out.session.id).toBe("s1");
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
        session: {
          id: "s1",
          chatId: 1,
          apiKeyPrefix: "cc_abcd",
          status: "active",
          createdAt: 0,
          revokedAt: null,
          lastHeartbeat: null
        },
        pendingToDaemon: 2,
        pendingToUser: 1,
        messages: []
      }
    });
    const out = await api.getSessionDetail("s1");
    expect(out?.pendingToDaemon).toBe(2);
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
  it("updateSession returns true on 200 and false on 404", async () => {
    responder = () => ({ status: 200, body: { ok: true } });
    expect(await api.updateSession("s1", { chatId: 9 })).toBe(true);

    responder = () => ({ status: 404, body: { error: { code: "NOT_FOUND", message: "" } } });
    expect(await api.updateSession("s1", { chatId: 9 })).toBe(false);
  });

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

  it("rotateSession returns null on 404, envelope on 200", async () => {
    responder = () => ({ status: 404, body: {} });
    expect(await api.rotateSession("s1", {})).toBeNull();

    responder = () => ({
      status: 200,
      body: {
        session: {
          id: "s2",
          chatId: 1,
          apiKeyPrefix: "cc_ef",
          status: "active",
          createdAt: 0,
          revokedAt: null,
          lastHeartbeat: null
        },
        rawApiKey: "new-key"
      }
    });
    const out = await api.rotateSession("s1", { rawApiKey: "new-key" });
    expect(out?.rawApiKey).toBe("new-key");
  });

  it("updateSession surfaces non-2xx/404 as ApiClientError", async () => {
    responder = () => ({
      status: 400,
      body: { error: { code: "VALIDATION_ERROR", message: "bad chatId" } }
    });
    await expect(api.updateSession("s1", { chatId: 1 })).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("message endpoints", () => {
  it("listMessages returns parsed list", async () => {
    responder = () => ({ status: 200, body: { messages: [] } });
    expect((await api.listMessages("s1")).messages).toEqual([]);
  });

  it("enqueueMessage returns null on 404", async () => {
    responder = () => ({ status: 404, body: {} });
    expect(await api.enqueueMessage("s1", { direction: "to_daemon", content: "x" })).toBeNull();
  });

  it("enqueueMessage returns envelope on 200", async () => {
    responder = () => ({
      status: 200,
      body: {
        message: {
          id: "m1",
          sessionId: "s1",
          direction: "to_daemon",
          content: "x",
          createdAt: 1
        },
        droppedOldestId: null
      }
    });
    const out = await api.enqueueMessage("s1", { direction: "to_daemon", content: "x" });
    expect(out?.message.id).toBe("m1");
  });

  it("getMessage returns null on 404", async () => {
    responder = () => ({ status: 404, body: {} });
    expect(await api.getMessage("nope")).toBeNull();
  });

  it("getMessage parses on 200", async () => {
    responder = () => ({
      status: 200,
      body: {
        id: "m1",
        sessionId: "s1",
        direction: "to_user",
        content: "hi",
        createdAt: 1
      }
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
  it("handles empty body gracefully", async () => {
    responder = () => ({ status: 200, body: { ok: true } });
    const ok = await api.revokeSession("s1");
    expect(ok).toBe(true);
  });

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
