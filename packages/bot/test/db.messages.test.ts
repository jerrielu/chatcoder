import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import { MAX_QUEUE_DEPTH } from "@chatcoder/shared";

let h: TestHarness;
let sessionId: string;

beforeEach(async () => {
  h = await makeHarness();
  const { session } = await h.sessions.rotate({ chatId: 1 });
  sessionId = session.id;
});
afterEach(async () => {
  await h.close();
});

describe("MessagesRepo enqueue + cap", () => {
  it("enqueues and retains FIFO", async () => {
    for (let i = 0; i < 3; i++) {
      h.advanceTime(1);
      await h.messages.enqueue({
        sessionId,
        direction: "to_daemon",
        content: `msg-${i}`
      });
    }
    const all = await h.messages.drain(sessionId, "to_daemon");
    expect(all.map((m) => m.content)).toEqual(["msg-0", "msg-1", "msg-2"]);
  });

  it("caps at MAX_QUEUE_DEPTH by dropping oldest", async () => {
    for (let i = 0; i < MAX_QUEUE_DEPTH + 3; i++) {
      h.advanceTime(1);
      await h.messages.enqueue({
        sessionId,
        direction: "to_daemon",
        content: `msg-${i}`
      });
    }
    const drained = await h.messages.drain(sessionId, "to_daemon");
    expect(drained).toHaveLength(MAX_QUEUE_DEPTH);
    expect(drained[0]!.content).toBe("msg-3"); // 0,1,2 dropped
    expect(drained.at(-1)!.content).toBe(`msg-${MAX_QUEUE_DEPTH + 2}`);
  });

  it("reports droppedOldestId when capped", async () => {
    const drops: Array<string | null> = [];
    for (let i = 0; i < MAX_QUEUE_DEPTH + 2; i++) {
      h.advanceTime(1);
      const r = await h.messages.enqueue({
        sessionId,
        direction: "to_daemon",
        content: `m${i}`
      });
      drops.push(r.droppedOldestId);
    }
    // First MAX_QUEUE_DEPTH enqueues → null, after that → non-null.
    expect(drops.slice(0, MAX_QUEUE_DEPTH).every((d) => d === null)).toBe(true);
    expect(drops.slice(MAX_QUEUE_DEPTH).every((d) => d !== null)).toBe(true);
  });
});

describe("MessagesRepo dequeue", () => {
  it("dequeueOldest pops and deletes", async () => {
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, direction: "to_user", content: "A" });
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, direction: "to_user", content: "B" });
    const first = await h.messages.dequeueOldest(sessionId, "to_user");
    expect(first?.content).toBe("A");
    expect(await h.messages.count(sessionId, "to_user")).toBe(1);
  });

  it("returns null when empty", async () => {
    expect(await h.messages.dequeueOldest(sessionId, "to_user")).toBeNull();
  });

  it("drain removes everything of one direction only", async () => {
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, direction: "to_daemon", content: "x" });
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, direction: "to_user", content: "y" });
    const drained = await h.messages.drain(sessionId, "to_daemon");
    expect(drained).toHaveLength(1);
    expect(await h.messages.count(sessionId, "to_user")).toBe(1);
  });
});

describe("MessagesRepo.purgeSession", () => {
  it("removes all messages for a session", async () => {
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, direction: "to_user", content: "a" });
    await h.messages.purgeSession(sessionId);
    expect(await h.messages.count(sessionId, "to_user")).toBe(0);
  });
});
