import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { ApiClient } from "../src/client.js";
import { DaemonConfig } from "../src/config.js";
import type { ToolExecutor } from "../src/toolExecutor.js";

function baseCfg(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return DaemonConfig.parse({
    apiUrl: "https://x.example.com",
    apiKey: "long-enough-api-key-abcdef",
    pollIntervalMs: 500,
    pollJitterMs: 0,
    heartbeatIntervalMs: 500,
    idleShutdownMs: 3_600_000,
    responseQuietMs: 100,
    ...overrides
  });
}

class FakeToolExecutor {
  calls: string[] = [];
  nextOutput = "default output";
  async execute(message: string): Promise<string> {
    this.calls.push(message);
    return this.nextOutput;
  }
}

interface Scenario {
  poll: Array<{ reset?: boolean; messages?: Array<{ id: string; content: string; createdAt: number }> } | "401" | "410" | "5xx">;
  heartbeat?: Array<"ok" | "410" | "401" | "5xx">;
  postResponse?: Array<"ok" | "410" | "401" | "5xx">;
}

function makeFetch(s: Scenario): {
  fn: typeof fetch;
  calls: string[];
  postBodies: unknown[];
} {
  let pi = 0;
  let hi = 0;
  let ri = 0;
  const calls: string[] = [];
  const postBodies: unknown[] = [];
  const fn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const pick = (arr: string[] | undefined, idx: number) => arr?.[idx] ?? "ok";
    if (url.endsWith("/v1/poll")) {
      const step = s.poll[pi++] ?? { messages: [] };
      if (step === "401") return new Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', { status: 401 });
      if (step === "410") return new Response('{"error":{"code":"SESSION_REVOKED","message":"x"}}', { status: 410 });
      if (step === "5xx") return new Response("{}", { status: 500 });
      return new Response(
        JSON.stringify({ reset: step.reset ?? false, sessionValid: true, messages: step.messages ?? [] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/v1/heartbeat")) {
      const v = pick(s.heartbeat, hi++);
      if (v === "ok") return new Response(JSON.stringify({ ok: true, reset: false, serverTime: 0 }), { status: 200 });
      if (v === "401") return new Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', { status: 401 });
      if (v === "410") return new Response('{"error":{"code":"SESSION_REVOKED","message":"x"}}', { status: 410 });
      return new Response("{}", { status: 500 });
    }
    if (url.endsWith("/v1/responses")) {
      postBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      const v = pick(s.postResponse, ri++);
      if (v === "ok") return new Response(JSON.stringify({ ok: true, droppedOldestId: null }), { status: 200 });
      if (v === "401") return new Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', { status: 401 });
      if (v === "410") return new Response('{"error":{"code":"SESSION_REVOKED","message":"x"}}', { status: 410 });
      return new Response("{}", { status: 500 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, calls, postBodies };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Orchestrator", () => {
  it("polls, dispatches instruction to tool, then posts response", async () => {
    const tool = new FakeToolExecutor();
    tool.nextOutput = "hi back";
    const { fn, calls, postBodies } = makeFetch({
      poll: [
        { messages: [{ id: "m1", content: "hello", createdAt: 1 }] },
        { messages: [] }
      ]
    });
    const client = new ApiClient({ apiUrl: "https://x.example.com", apiKey: "long-enough-api-key-abcdef", fetchImpl: fn, retries: 0 });
    const orch = new Orchestrator({ config: baseCfg(), client, tool: tool as unknown as ToolExecutor });
    orch.start();
    // first tick
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    
    expect(tool.calls).toEqual(["hello"]);
    expect(postBodies).toEqual([{ content: "hi back" }]);
    expect(calls.some((c) => c.includes("/v1/heartbeat"))).toBe(true);
    await orch.stop();
  });

  it("stops on SessionRevokedError", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({ poll: ["410"] });
    const client = new ApiClient({ apiUrl: "https://x.example.com", apiKey: "long-enough-api-key-abcdef", fetchImpl: fn, retries: 0 });
    const orch = new Orchestrator({ config: baseCfg(), client, tool: tool as unknown as ToolExecutor });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(orch.status).toBe("session_revoked");
    await orch.stop();
  });

  it("stops on UnauthorizedError", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({ poll: ["401"] });
    const client = new ApiClient({ apiUrl: "https://x.example.com", apiKey: "long-enough-api-key-abcdef", fetchImpl: fn, retries: 0 });
    const orch = new Orchestrator({ config: baseCfg(), client, tool: tool as unknown as ToolExecutor });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(orch.status).toBe("unauthorized");
    await orch.stop();
  });

  it("start is idempotent", () => {
    const tool = new FakeToolExecutor();
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: makeFetch({ poll: [{ messages: [] }] }).fn,
      retries: 0
    });
    const orch = new Orchestrator({ config: baseCfg(), client, tool: tool as unknown as ToolExecutor });
    orch.start();
    orch.start();
    expect(orch.status).toBe("running");
  });

  it("stop() best-effort heartbeat error is swallowed", async () => {
    const tool = new FakeToolExecutor();
    let heartbeatCalls = 0;
    const fetchImpl = (async (input: URL | RequestInfo, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/heartbeat")) {
        heartbeatCalls++;
        throw new Error("network down");
      }
      if (url.endsWith("/v1/poll")) {
        return new Response(
          JSON.stringify({ reset: false, sessionValid: true, messages: [] }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      retries: 0,
      fetchImpl
    });
    const orch = new Orchestrator({ config: baseCfg(), client, tool: tool as unknown as ToolExecutor });
    orch.start();
    await expect(orch.stop()).resolves.toBeUndefined();
    expect(heartbeatCalls).toBeGreaterThan(0);
  });

  it("swallows transient poll error and continues", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({ poll: ["5xx", { messages: [] }] });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const orch = new Orchestrator({ config: baseCfg(), client, tool: tool as unknown as ToolExecutor });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(orch.status).toBe("running");
    await orch.stop();
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
