import { describe, it, expect } from "vitest";
import { ApiClient, ApiClientError } from "../src/client.js";

describe("ApiClient edge cases", () => {
  it("retries on network failure and eventually gives up", async () => {
    let tries = 0;
    const fetchImpl = (async () => {
      tries++;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "long-enough-key-abcdef",
      retries: 2,
      backoffMs: 1,
      fetchImpl
    });
    await expect(c.heartbeat()).rejects.toThrow(/ECONNREFUSED/);
    expect(tries).toBe(3);
  });

  it("handles error response whose body isn't JSON", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 400 })) as unknown as typeof fetch;
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "long-enough-key-abcdef",
      retries: 0,
      fetchImpl
    });
    await expect(
      c.postResponse({ sessionId: "s", content: "x" })
    ).rejects.toThrow(/INTERNAL: HTTP 400/);
  });

  it("does not retry 4xx client errors", async () => {
    let tries = 0;
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "bad" } }),
        { status: 400, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const countingFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      tries++;
      return fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const c = new ApiClient({
      apiUrl: "https://x",
      apiKey: "long-enough-key-abcdef",
      retries: 3,
      backoffMs: 1,
      fetchImpl: countingFetch
    });
    await expect(
      c.postResponse({ sessionId: "s", content: "x" })
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(tries).toBe(1);
  });
});
