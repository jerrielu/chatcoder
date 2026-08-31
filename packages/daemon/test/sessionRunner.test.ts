import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionRunner } from "../src/sessionRunner.js";
import type { ToolExecutor } from "../src/toolExecutor.js";
import type { Profile } from "../src/profile.js";
import { DaemonConfig } from "../src/config.js";

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
  nextOutput = "ok";
  async execute(): Promise<string> {
    return this.nextOutput;
  }
}

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

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("SessionRunner pendingFinalAck", () => {
  it("starts false on a fresh runner", () => {
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: new FakeToolExecutor() as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    expect(runner.hasPendingFinalAck).toBe(false);
  });

  it("stays false throughout a normal task (the happy-path bug fix)", async () => {
    // Regression guard for the c48e53e follow-up: setting pendingFinalAck
    // eagerly at the start of runOne made the orchestrator poll the bot
    // with resumeInProgress=1 for the entire duration of a normal task,
    // which caused the bot to hand back a "continue" resume task per
    // poll while the task was still running. The runner then drained a
    // flood of spurious "continue" turns after the original task
    // completed. The flag must only flip on when the final POST
    // actually fails.
    let postedFinal = 0;
    let observedWhileRunning: boolean | null = null;
    const tool = {
      execute: async () => {
        // Sample the flag mid-execution — it must still be false.
        observedWhileRunning = runner.hasPendingFinalAck;
        return "ok";
      }
    };
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (_sessionId, _content, opts) => {
        if (opts?.final) postedFinal += 1;
      }
    });
    runner.enqueue({
      sessionId: "s1",
      messageId: "m1",
      kind: "instruction",
      content: "hi"
    });
    await flushMicrotasks();
    expect(postedFinal).toBe(1);
    expect(observedWhileRunning).toBe(false);
    expect(runner.hasPendingFinalAck).toBe(false);
  });

  it("stays true when the final POST throws (the wedge case)", async () => {
    // The bug: when the daemon's POST to the bot fails (timeout, 5xx,
    // network), the runner must remember the final was not delivered so
    // the orchestrator keeps asking the bot to resume the in-progress
    // task. Without this flag, the bot wedges the session forever.
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: new FakeToolExecutor() as unknown as ToolExecutor,
      postResponse: async () => {
        throw new Error("Request timeout");
      }
    });
    runner.enqueue({
      sessionId: "s1",
      messageId: "m1",
      kind: "instruction",
      content: "hi"
    });
    // Let the runner run and fail to post.
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    // Drain (so whenIdle resolves), but the pending ack must remain.
    await runner.whenIdle();
    expect(runner.hasPendingFinalAck).toBe(true);
  });

  it("stop tasks do not set pendingFinalAck (the abort path is its own confirmation)", async () => {
    let postedFinal = 0;
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: new FakeToolExecutor() as unknown as ToolExecutor,
      postResponse: async (_sessionId, _content, opts) => {
        if (opts?.final) postedFinal += 1;
      }
    });
    runner.enqueue({
      sessionId: "s1",
      messageId: "m-stop",
      kind: "stop",
      content: "stop"
    });
    await flushMicrotasks();
    expect(postedFinal).toBeGreaterThanOrEqual(1);
    expect(runner.hasPendingFinalAck).toBe(false);
  });

  it("recovered after a successful resume: pendingFinalAck flips back to false on the next successful final", async () => {
    // Models the self-heal flow: first call's final POST fails, second
    // call's final POST (after the bot handed the same row back with
    // content=continue) succeeds, pendingFinalAck returns to false.
    let deliver = false;
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: new FakeToolExecutor() as unknown as ToolExecutor,
      postResponse: async () => {
        if (!deliver) throw new Error("transient");
      }
    });
    // Run 1: fails to deliver.
    runner.enqueue({
      sessionId: "s1",
      messageId: "m1",
      kind: "instruction",
      content: "hi"
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await runner.whenIdle();
    expect(runner.hasPendingFinalAck).toBe(true);
    // Network "heals" between tasks.
    deliver = true;
    // Run 2 (the bot handed the same row back via resumeInProgress): succeeds.
    runner.enqueue({
      sessionId: "s1",
      messageId: "m1",
      kind: "instruction",
      content: "continue"
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await runner.whenIdle();
    expect(runner.hasPendingFinalAck).toBe(false);
  });
});
