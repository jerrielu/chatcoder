import { describe, it, expect } from "vitest";
import { ApiClient, SessionRevokedError, UnauthorizedError } from "../src/client.js";

function makeFetch(
  responder: (input: string, init: RequestInit) => { status: number; body?: unknown }
): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const res = responder(String(input), init ?? {});
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
}

describe("ApiClient", () => {
  it("sends Bearer header and JSON body", async () => {
    let seenAuth = "";
    let seenBody = "";
    const fetchImpl = makeFetch((_url, init) => {
      seenAuth = (init.headers as Record<string, string>).authorization;
      seenBody = String(init.body ?? "");
      return { status: 200, body: { ok: true, reset: false, serverTime: 0 } };
    });
    const c = new ApiClient({ apiUrl: "https://x", apiKey: "cc_ABCDEFG", fetchImpl, retries: 0 });
    await c.heartbeat({ note: "alive" });
    expect(seenAuth).toBe("Bearer cc_ABCDEFG");
    expect(JSON.parse(seenBody)).toEqual({ note: "alive" });
  });

  it("register returns the parsed response", async () => {
    const fetchImpl = makeFetch(() => ({
      status: 200,
      body: {
        apiKeyId: "a1",
        profiles: [{ id: "p1", name: "main", tool: "CLAUDE_CODE" }]
      }
    }));
    const c = new ApiClient({ apiUrl: "https://x", apiKey: "k", fetchImpl, retries: 0 });
    const r = await c.register({
      profiles: [{ name: "main", tool: "CLAUDE_CODE" }]
    });
    expect(r.apiKeyId).toBe("a1");
    expect(r.profiles[0]!.name).toBe("main");
  });

  it("throws UnauthorizedError on 401", async () => {
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "k",
      fetchImpl: makeFetch(() => ({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "x" } } })),
      retries: 0
    });
    await expect(c.poll()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws SessionRevokedError on 410", async () => {
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "k",
      fetchImpl: makeFetch(() => ({
        status: 410,
        body: { error: { code: "SESSION_REVOKED", message: "x" } }
      })),
      retries: 0
    });
    await expect(c.poll()).rejects.toBeInstanceOf(SessionRevokedError);
  });

  it("retries on 5xx then succeeds", async () => {
    let call = 0;
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "k",
      retries: 2,
      backoffMs: 1,
      fetchImpl: makeFetch(() => {
        call++;
        if (call < 3) return { status: 500, body: {} };
        return { status: 200, body: { reset: false, sessions: [] } };
      })
    });
    const r = await c.poll();
    expect(r.sessions).toEqual([]);
    expect(call).toBe(3);
  });

  it("throws after exhausting retries", async () => {
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "k",
      retries: 1,
      backoffMs: 1,
      fetchImpl: makeFetch(() => ({ status: 500, body: {} }))
    });
    await expect(c.poll()).rejects.toThrow(/server 500/);
  });

  it("surfaces non-5xx non-auth API error envelope", async () => {
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "k",
      retries: 0,
      fetchImpl: makeFetch(() => ({
        status: 400,
        body: { error: { code: "VALIDATION_ERROR", message: "bad" } }
      }))
    });
    await expect(
      c.postResponse({ sessionId: "s", content: "x" })
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("strips trailing slash from apiUrl", async () => {
    let url = "";
    const c = new ApiClient({
      apiUrl: "https://x/",
      apiKey: "k",
      retries: 0,
      fetchImpl: makeFetch((u) => {
        url = u;
        return { status: 200, body: { ok: true, reset: false, serverTime: 0 } };
      })
    });
    await c.heartbeat();
    expect(url).toBe("https://x/v1/heartbeat");
  });
});
