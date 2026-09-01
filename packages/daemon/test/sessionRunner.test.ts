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

describe("SessionRunner task heartbeat", () => {
  it("sends a heartbeat every interval while a task is in flight", async () => {
    const heartbeat = vi.fn(async () => undefined);
    let releaseTool: (() => void) | null = null;
    const tool = {
      execute: async () =>
        new Promise<string>((resolve) => {
          releaseTool = () => resolve("ok");
        })
    };
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined,
      taskHeartbeat: heartbeat,
      taskHeartbeatIntervalMs: 1_000
    });
    runner.enqueue({ sessionId: "s1", messageId: "m1", kind: "instruction", content: "hi" });
    await flushMicrotasks();
    expect(heartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledWith("s1", "m1");
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    expect(heartbeat).toHaveBeenCalledTimes(2);

    releaseTool?.();
    await flushMicrotasks();
    await runner.whenIdle();
    const after = heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    await flushMicrotasks();
    expect(heartbeat.mock.calls.length).toBe(after);
  });

  it("stops heartbeating after the task completes", async () => {
    const heartbeat = vi.fn(async () => undefined);
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: new FakeToolExecutor() as unknown as ToolExecutor,
      postResponse: async () => undefined,
      taskHeartbeat: heartbeat,
      taskHeartbeatIntervalMs: 1_000
    });
    runner.enqueue({ sessionId: "s1", messageId: "m1", kind: "instruction", content: "hi" });
    await flushMicrotasks();
    await runner.whenIdle();
    const count = heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    await flushMicrotasks();
    expect(heartbeat.mock.calls.length).toBe(count);
  });

  it("does not heartbeat for stop tasks", async () => {
    const heartbeat = vi.fn(async () => undefined);
    const runner = new SessionRunner("s1", {
      sessionId: "s1",
      profile: sampleProfile(),
      tool: new FakeToolExecutor() as unknown as ToolExecutor,
      postResponse: async () => undefined,
      taskHeartbeat: heartbeat,
      taskHeartbeatIntervalMs: 1_000
    });
    runner.enqueue({ sessionId: "s1", messageId: "m-stop", kind: "stop", content: "stop" });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    await flushMicrotasks();
    expect(heartbeat).not.toHaveBeenCalled();
  });
});
