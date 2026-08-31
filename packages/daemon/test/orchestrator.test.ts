import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { ApiClient } from "../src/client.js";
import { DaemonConfig } from "../src/config.js";
import { SessionManager } from "../src/sessionManager.js";
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
  nextOutput = '{"response": "hi back"}';
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
    tool.nextOutput = '{"response": "pong"}';
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: (sessionId, content) => client.postResponse({ sessionId, content }).then(() => undefined)
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await sessionManager.drainAll();

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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await sessionManager.drainAll();
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await sessionManager.drainAll();
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    await flushMicrotasks();

    const pollCalls = calls.filter((c) => c.includes("/v1/poll"));
    expect(pollCalls[0]).toContain("resumeInProgress=1");
    expect(pollCalls[1]).not.toContain("resumeInProgress=1");
    await orch.stop();
  });

  it("does NOT spam resumeInProgress while a normal task is in flight (happy-path regression)", async () => {
    // Regression guard for the 0.15.4 → 0.15.5 fix: while a long-running
    // task executes normally with NO wedge, every poll fired during the
    // task's lifetime must NOT carry resumeInProgress=1, otherwise the
    // bot hands back a "continue" resume task per poll and the runner
    // drains a flood of spurious "continue" turns after the original
    // task completes. The flag should only be true after a final POST
    // actually fails, never just because a task is executing.
    const polledResumeFlags: boolean[] = [];
    const calls: string[] = [];
    let pi = 0;
    const c = cfg();
    const tool = {
      execute: async (
        _profile: Profile,
        _message: string,
        _opts?: { resumeLastSession?: boolean }
      ): Promise<string> => {
        // Pretend the task is still running. Capture what the daemon
        // polls while we sit here.
        const seen: boolean[] = [];
        for (let i = 0; i < 5; i++) {
          await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
          await flushMicrotasks();
          const polls = calls.filter((cl) => cl.includes("/v1/poll"));
          seen.push(
            polls[polls.length - 1]?.includes("resumeInProgress=1") ?? false
          );
        }
        polledResumeFlags.push(...seen);
        return '{"response": "done"}';
      }
    };
    const fn = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (new URL(url).pathname === "/v1/poll") {
        // First poll hands back M1 (claimNext path). Subsequent polls
        // have an in-progress row from M1's claim; with the fix the
        // daemon MUST NOT set resumeInProgress=1, so the bot returns
        // nothing and the session is omitted.
        const step = pi++;
        if (step === 0) {
          return new Response(
            JSON.stringify({
              reset: false,
              sessions: [
                {
                  sessionId: "s1",
                  profileName: "main",
                  messages: [{ id: "m1", content: "hi", createdAt: 1 }]
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ reset: false, sessions: [] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/v1/heartbeat")) {
        return new Response(JSON.stringify({ ok: true, reset: false, serverTime: 0 }), {
          status: 200
        });
      }
      if (url.endsWith("/v1/responses")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      apiUrl: "https://x.example.com",
      apiKey: "long-enough-api-key-abcdef",
      fetchImpl: fn,
      retries: 0
    });
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    await vi.advanceTimersByTimeAsync(0);
    await sessionManager.drainAll();
    await orch.stop();
    // Every poll observed while the task was running must have
    // resumeInProgress=0 (the gate must be off because no final POST
    // failed). The only poll that may carry resumeInProgress=1 is the
    // very first one (covered by the "first poll only" test above),
    // which fires BEFORE the task starts running — so even that one
    // isn't in our sample window.
    expect(polledResumeFlags.length).toBeGreaterThanOrEqual(3);
    for (const flag of polledResumeFlags) {
      expect(flag).toBe(false);
    }
  });

  it("re-asks the API to resume in-progress work while a runner's final ack is still pending", async () => {
    // Models the wedge-recovery flow: a runner's final-POST failed (the
    // runner still has pendingFinalAck=true), so subsequent polls must
    // continue sending resumeInProgress=1 so the bot hands back the same
    // in-progress row and the daemon re-runs the task until the final
    // delivery succeeds. This is the fix for the "stuck 🔄 blocks every
    // following message" bug.
    const tool = new FakeToolExecutor();
    const { fn, calls } = makeFetch({
      poll: [
        { sessions: [] },
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => {
        throw new Error("simulated final-POST failure");
      }
    });
    // Inject a wedged runner directly. The real SessionRunner exposes the
    // same shape via hasPendingFinalAck; we use a lightweight stand-in here
    // to keep this test focused on the orchestrator's gating behaviour.
    const fakeRunner = { hasPendingFinalAck: true, stop: async () => undefined } as {
      hasPendingFinalAck: boolean;
      stop: () => Promise<void>;
    };
    (sessionManager as unknown as { runners: Map<string, typeof fakeRunner> }).runners.set(
      "wedged",
      fakeRunner
    );
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    // Each advanceTimersByTimeAsync fires one poll. With a fake runner
    // that stays wedged forever, every poll must keep the
    // resumeInProgress=1 flag set so the bot hands back the same row.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    await flushMicrotasks();

    const pollCalls = calls.filter((c) => c.includes("/v1/poll"));
    expect(pollCalls.length).toBe(3);
    for (const pc of pollCalls) {
      expect(pc).toContain("resumeInProgress=1");
    }
    await orch.stop();
  });

  it("stops sending resumeInProgress once the wedged runner recovers (pendingFinalAck cleared)", async () => {
    // Verifies the gate flips off automatically when the runner clears its
    // pendingFinalAck — i.e. once a successful final POST lands, the
    // orchestrator stops asking the bot to resume, and normal claimNext
    // flow takes over.
    const tool = new FakeToolExecutor();
    const { fn, calls } = makeFetch({
      poll: [
        { sessions: [] },
        { sessions: [] },
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const fakeRunner = { hasPendingFinalAck: true, stop: async () => undefined } as {
      hasPendingFinalAck: boolean;
      stop: () => Promise<void>;
    };
    (sessionManager as unknown as { runners: Map<string, typeof fakeRunner> }).runners.set(
      "wedged",
      fakeRunner
    );
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    // 1st poll: shouldResumeInProgress=true → resumeInProgress=1.
    await vi.advanceTimersByTimeAsync(0);
    // 2nd poll: hasPendingFinalAcks()=true → resumeInProgress=1.
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    // Simulate the runner recovering: final POST succeeded.
    fakeRunner.hasPendingFinalAck = false;
    // 3rd poll: pendingFinalAck=false → resumeInProgress=0.
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    // 4th poll: still no pending → resumeInProgress=0.
    await vi.advanceTimersByTimeAsync(c.pollIntervalMs);
    await flushMicrotasks();

    const pollCalls = calls.filter((c) => c.includes("/v1/poll"));
    expect(pollCalls.length).toBe(4);
    // First two polls: resumeInProgress=1.
    expect(pollCalls[0]).toContain("resumeInProgress=1");
    expect(pollCalls[1]).toContain("resumeInProgress=1");
    // Third and fourth polls: pendingFinalAck cleared, no resume flag.
    expect(pollCalls[2]).not.toContain("resumeInProgress=1");
    expect(pollCalls[3]).not.toContain("resumeInProgress=1");
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: (sessionId, content) => client.postResponse({ sessionId, content }).then(() => undefined)
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
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
    const sessionManager = new SessionManager({
      config: c,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: c, client, sessionManager });
    orch.start();
    orch.start();
    expect(orch.status).toBe("running");
  });
});

describe("SessionManager concurrency", () => {
  it("runs different sessions in parallel but each session FIFO", async () => {
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
    const sessionManager = new SessionManager({
      config: { profiles },
      tool: tool as unknown as ToolExecutor,
      postResponse: async (sessionId, content) => {
        posted.push({ sessionId, content });
      }
    });

    sessionManager.enqueue("s1", profiles[0]!, { sessionId: "s1", messageId: "m1", kind: "instruction", content: "a" });
    sessionManager.enqueue("s1", profiles[0]!, { sessionId: "s1", messageId: "m2", kind: "instruction", content: "b" });
    sessionManager.enqueue("s2", profiles[1]!, { sessionId: "s2", messageId: "m3", kind: "instruction", content: "c" });
    await sessionManager.drainAll();

    // Within "s1" FIFO is preserved:
    expect(order.indexOf("end main:a")).toBeLessThan(order.indexOf("start main:b"));
    // "s2" (different session) starts before "s1:b" ends — parallelism.
    expect(order.indexOf("start other:c")).toBeLessThan(order.indexOf("end main:b"));

    expect(posted).toHaveLength(3);
    expect(posted.filter((p) => p.sessionId === "s1")).toHaveLength(2);
    expect(posted.filter((p) => p.sessionId === "s2")).toHaveLength(1);
  });
});
