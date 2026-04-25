import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProfileRunner } from "../src/profileRunner.js";
import type { ToolExecutor } from "../src/toolExecutor.js";
import type { Profile } from "../src/profile.js";

function sampleProfile(name = "main"): Profile {
  return {
    name,
    cwd: "/tmp",
    tool: "CLAUDE_CODE",
    claudeCode: {
      apiKey: "k",
      skipPermissions: false,
      outputFormat: "text",
      extraArgs: []
    }
  };
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ProfileRunner", () => {
  it("processes enqueued tasks serially (FIFO) within one profile", async () => {
    const order: string[] = [];
    const tool = {
      execute: async (_profile: Profile, message: string) => {
        order.push(`start:${message}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end:${message}`);
        return `done-${message}`;
      }
    };
    const posted: Array<{ sessionId: string; content: string }> = [];
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (sessionId, content) => {
        posted.push({ sessionId, content });
      }
    });
    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "a" });
    runner.enqueue({ sessionId: "s1", messageId: "m2", content: "b" });
    runner.enqueue({ sessionId: "s1", messageId: "m3", content: "c" });
    await runner.whenIdle();

    // FIFO: task b starts only after a ends
    expect(order.indexOf("end:a")).toBeLessThan(order.indexOf("start:b"));
    expect(order.indexOf("end:b")).toBeLessThan(order.indexOf("start:c"));
    expect(posted.map((p) => p.content)).toEqual(["done-a", "done-b", "done-c"]);
  });

  it("posts an Error-prefixed response when the tool rejects", async () => {
    const tool = {
      execute: async () => {
        throw new Error("boom");
      }
    };
    const posted: Array<{ sessionId: string; content: string }> = [];
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (sessionId, content) => {
        posted.push({ sessionId, content });
      }
    });
    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "x" });
    await runner.whenIdle();
    expect(posted).toHaveLength(1);
    expect(posted[0]!.content).toMatch(/^Error: boom/);
  });

  it("chunks large outputs at responseChunkMaxChars", async () => {
    const big = "x".repeat(50);
    const tool = {
      execute: async () => big
    };
    const posted: Array<{ sessionId: string; content: string }> = [];
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (sessionId, content) => {
        posted.push({ sessionId, content });
      },
      responseChunkMaxChars: 20
    });
    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "go" });
    await runner.whenIdle();
    expect(posted).toHaveLength(3);
    expect(posted.map((p) => p.content).join("")).toBe(big);
  });
});
