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

  it("posts streamed output as progress and final output only as final", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:34:56.000Z"));
    const tool = {
      execute: async (_profile: Profile, _message: string, opts: { onOutput?: (chunk: string) => void }) => {
        opts.onOutput?.("working");
        await new Promise((r) => setTimeout(r, 10));
        return "done";
      }
    };
    const posted: Array<{ sessionId: string; content: string; final?: boolean }> = [];
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (sessionId, content, opts) => {
        posted.push({ sessionId, content, final: opts?.final });
      },
      responseUpdateIntervalMs: 5
    });
    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "go" });
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(10);
    await runner.whenIdle();
    expect(posted).toEqual([
      { sessionId: "s1", content: "[2026-04-25T12:34:56.005Z] working", final: false },
      { sessionId: "s1", content: "done", final: true }
    ]);
  });

  it("limits progress updates to the first 50 words with a timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:34:56.000Z"));
    const words = Array.from({ length: 55 }, (_, i) => `word${i + 1}`);
    const tool = {
      execute: async (_profile: Profile, _message: string, opts: { onOutput?: (chunk: string) => void }) => {
        opts.onOutput?.(words.join(" "));
        await new Promise((r) => setTimeout(r, 10));
        return "done";
      }
    };
    const posted: Array<{ content: string; final?: boolean }> = [];
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (_sessionId, content, opts) => {
        posted.push({ content, final: opts?.final });
      },
      responseUpdateIntervalMs: 5
    });

    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "go" });
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(10);
    await runner.whenIdle();

    const expectedProgress = `[2026-04-25T12:34:56.005Z] ${words.slice(0, 50).join(" ")}`;
    expect(posted).toEqual([
      { content: expectedProgress, final: false },
      { content: "done", final: true }
    ]);
    expect(posted[0]!.content).not.toContain("word51");
  });

  it("does not crash or block the queue when posting a response fails", async () => {
    const tool = {
      execute: async (_profile: Profile, message: string) => `done-${message}`
    };
    const posted: string[] = [];
    const logs: Array<{ msg: string; extra?: unknown }> = [];
    let attempts = 0;
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (_sessionId, content) => {
        attempts++;
        if (attempts === 1) throw new Error("bot unavailable");
        posted.push(content);
      },
      log: (msg, extra) => logs.push({ msg, extra })
    });

    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "first" });
    runner.enqueue({ sessionId: "s1", messageId: "m2", content: "second" });
    await runner.whenIdle();

    expect(posted).toEqual(["done-second"]);
    expect(logs.some((entry) => entry.msg === "response post failed")).toBe(true);
  });

  it("contains progress post failures from timer ticks", async () => {
    vi.useFakeTimers();
    const tool = {
      execute: async (_profile: Profile, _message: string, opts: { onOutput?: (chunk: string) => void }) => {
        opts.onOutput?.("working");
        await new Promise((r) => setTimeout(r, 10));
        return "done";
      }
    };
    const posted: string[] = [];
    const logs: Array<{ msg: string; extra?: unknown }> = [];
    const runner = new ProfileRunner({
      profile: sampleProfile(),
      tool: tool as unknown as ToolExecutor,
      postResponse: async (_sessionId, content, opts) => {
        if (opts?.final) posted.push(content);
        else throw new Error("temporary bot post failure");
      },
      log: (msg, extra) => logs.push({ msg, extra }),
      responseUpdateIntervalMs: 5
    });

    runner.enqueue({ sessionId: "s1", messageId: "m1", content: "go" });
    await vi.advanceTimersByTimeAsync(5);
    await vi.advanceTimersByTimeAsync(10);
    await runner.whenIdle();

    expect(posted).toEqual(["done"]);
    expect(logs.some((entry) => entry.msg === "response post failed")).toBe(true);
  });
});
