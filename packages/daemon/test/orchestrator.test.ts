import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { ApiClient } from "../src/client.js";
import { DaemonConfig } from "../src/config.js";
import { ProfilePool } from "../src/profilePool.js";
import type { ToolExecutor } from "../src/toolExecutor.js";
import type { Profile } from "../src/profile.js";
import type { CodexReasoningEffort } from "@chatcoder/shared";

function cfg(): DaemonConfig {
  return DaemonConfig.parse({
    apiUrl: "https://x.example.com",
    apiKey: "long-enough-api-key-abcdef",
    pollIntervalMs: 500,
    pollJitterMs: 0,
    heartbeatIntervalMs: 500,
    profiles: [sampleProfile()]
  });
}

function sampleProfile(): Profile {
  return {
    name: "main",
    tool: "CLAUDE_CODE",
    claudeCode: {
      authToken: "k",
      skipPermissions: false,
      outputFormat: "text",
      extraArgs: []
    }
  };
}

class FakeToolExecutor {
  nextOutput = "hi back";
  calls: Array<{
    profile: string;
    message: string;
    resumeLastSession: boolean;
    codexReasoningEffort?: CodexReasoningEffort;
  }> = [];
  async execute(
    profile: Profile,
    message: string,
    execOpts?: {
      resumeLastSession?: boolean;
      codexReasoningEffort?: CodexReasoningEffort;
    }
  ): Promise<string> {
    const effort = execOpts?.codexReasoningEffort;
    this.calls.push({
      profile: profile.name,
      message,
      resumeLastSession: execOpts?.resumeLastSession ?? true,
      ...(effort ? { codexReasoningEffort: effort } : {})
    });
    return this.nextOutput;
  }
}

function makeFetch(scenarios: {
  poll?: Array<{
    sessions?: Array<{
      sessionId: string;
      profileName: string;
      messages: Array<{
        id: string;
        content: string;
        createdAt: number;
        resumeLastSession?: boolean;
        codexReasoningEffort?: CodexReasoningEffort;
      }>;
    }>;
    reset?: boolean;
  } | "401" | "410" | "5xx">;
  heartbeat?: Array<"ok" | "401" | "410" | "5xx">;
  responses?: Array<"ok" | "401" | "410" | "5xx">;
}): { fn: typeof fetch; calls: string[]; postBodies: Array<{ sessionId: string; content: string }> } {
  let pi = 0;
  let hi = 0;
  let ri = 0;
  const calls: string[] = [];
  const postBodies: Array<{ sessionId: string; content: string }> = [];
  const fn = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (new URL(url).pathname === "/v1/poll") {
      const step = scenarios.poll?.[pi++] ?? { sessions: [] };
      if (step === "401") return new Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', { status: 401 });
      if (step === "410") return new Response('{"error":{"code":"SESSION_REVOKED","message":"x"}}', { status: 410 });
      if (step === "5xx") return new Response("{}", { status: 500 });
      return new Response(
        JSON.stringify({ reset: step.reset ?? false, sessions: step.sessions ?? [] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.endsWith("/v1/heartbeat")) {
      const v = scenarios.heartbeat?.[hi++] ?? "ok";
      if (v === "ok") return new Response(JSON.stringify({ ok: true, reset: false, serverTime: 0 }), { status: 200 });
      if (v === "401") return new Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', { status: 401 });
      if (v === "410") return new Response('{"error":{"code":"SESSION_REVOKED","message":"x"}}', { status: 410 });
      return new Response("{}", { status: 500 });
    }
    if (url.endsWith("/v1/responses")) {
      postBodies.push(JSON.parse(String(init?.body ?? "{}")) as { sessionId: string; content: string });
      const v = scenarios.responses?.[ri++] ?? "ok";
      if (v === "ok") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (v === "401") return new Response('{"error":{"code":"UNAUTHORIZED","message":"x"}}', { status: 401 });
      if (v === "410") return new Response('{"error":{"code":"SESSION_REVOKED","message":"x"}}', { status: 410 });
      return new Response("{}", { status: 500 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, calls, postBodies };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("Orchestrator", () => {
  it("dispatches a polled instruction to the runner and posts its output", async () => {
    const tool = new FakeToolExecutor();
    tool.nextOutput = "pong";
    const { fn, postBodies } = makeFetch({
      poll: [
        {
          sessions: [
            {
              sessionId: "s1",
              profileName: "main",
              messages: [{ id: "m1", content: "ping", createdAt: 1 }]
            }
          ]
        },
        { sessions: [] }
      ]
    });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: (sessionId, content) => client.postResponse({ sessionId, content }).then(() => undefined)
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await pool.drainAll();

    expect(tool.calls).toEqual([{ profile: "main", message: "ping", resumeLastSession: true }]);
    expect(postBodies).toEqual([{ sessionId: "s1", content: "pong" }]);
    await orch.stop();
  });

  it("passes resumeLastSession=false from poll messages into the executor", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({
      poll: [
        {
          sessions: [
            {
              sessionId: "s1",
              profileName: "main",
              messages: [{ id: "m1", content: "ping", createdAt: 1, resumeLastSession: false }]
            }
          ]
        }
      ]
    });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await pool.drainAll();
    expect(tool.calls).toEqual([{ profile: "main", message: "ping", resumeLastSession: false }]);
    await orch.stop();
  });

  it("passes codexReasoningEffort from poll messages into the executor", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({
      poll: [
        {
          sessions: [
            {
              sessionId: "s1",
              profileName: "main",
              messages: [
                {
                  id: "m1",
                  content: "ping",
                  createdAt: 1,
                  codexReasoningEffort: "xhigh"
                }
              ]
            }
          ]
        }
      ]
    });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await pool.drainAll();
    expect(tool.calls).toEqual([
      {
        profile: "main",
        message: "ping",
        resumeLastSession: true,
        codexReasoningEffort: "xhigh"
      }
    ]);
    await orch.stop();
  });

  it("asks the API to resume in-progress work on the first poll only", async () => {
    const tool = new FakeToolExecutor();
    const { fn, calls } = makeFetch({
      poll: [
        { sessions: [] },
        { sessions: [] }
      ]
    });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    await flushMicrotasks();

    const pollCalls = calls.filter((c) => c.includes("/v1/poll"));
    expect(pollCalls[0]).toContain("resumeInProgress=1");
    expect(pollCalls[1]).not.toContain("resumeInProgress=1");
    await orch.stop();
  });

  it("skips messages for an unknown profile rather than crashing", async () => {
    const tool = new FakeToolExecutor();
    const { fn, postBodies } = makeFetch({
      poll: [
        {
          sessions: [
            {
              sessionId: "s-foreign",
              profileName: "not-in-config",
              messages: [{ id: "m1", content: "ignored", createdAt: 1 }]
            }
          ]
        }
      ]
    });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: (sessionId, content) => client.postResponse({ sessionId, content }).then(() => undefined)
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(tool.calls).toEqual([]);
    expect(postBodies).toEqual([]);
    await orch.stop();
  });

  it("stops on SessionRevokedError (api key revoked)", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({ poll: ["410"] });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(orch.status).toBe("session_revoked");
    await orch.stop();
  });

  it("stops on UnauthorizedError", async () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({ poll: ["401"] });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(orch.status).toBe("unauthorized");
    await orch.stop();
  });

  it("start is idempotent", () => {
    const tool = new FakeToolExecutor();
    const { fn } = makeFetch({ poll: [{ sessions: [] }] });
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const c = cfg();
    const pool = new ProfilePool({
      profiles: c.profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, pool });
    orch.start();
    orch.start();
    expect(orch.status).toBe("running");
  });
});

describe("ProfilePool concurrency", () => {
  it("runs different profiles in parallel but within a profile FIFO", async () => {
    const profiles: Profile[] = [
      sampleProfile(),
      { ...sampleProfile(), name: "other" }
    ];
    const order: string[] = [];
    const tool = {
      execute: async (profile: Profile, message: string) => {
        order.push(`start ${profile.name}:${message}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end ${profile.name}:${message}`);
        return `done-${profile.name}`;
      }
    };
    vi.useRealTimers();
    const posted: Array<{ sessionId: string; content: string }> = [];
    const pool = new ProfilePool({
      profiles,
      tool: tool as unknown as ToolExecutor,
      postResponse: async (sessionId, content) => {
        posted.push({ sessionId, content });
      }
    });

    pool.enqueue("main", { sessionId: "s1", messageId: "m1", content: "a" });
    pool.enqueue("main", { sessionId: "s1", messageId: "m2", content: "b" });
    pool.enqueue("other", { sessionId: "s2", messageId: "m3", content: "c" });
    await pool.drainAll();

    // Within "main" FIFO is preserved:
    expect(order.indexOf("end main:a")).toBeLessThan(order.indexOf("start main:b"));
    // "other" starts before "main:b" ends — parallelism.
    expect(order.indexOf("start other:c")).toBeLessThan(order.indexOf("end main:b"));

    expect(posted).toHaveLength(3);
    expect(posted.filter((p) => p.sessionId === "s1")).toHaveLength(2);
    expect(posted.filter((p) => p.sessionId === "s2")).toHaveLength(1);
  });
});
