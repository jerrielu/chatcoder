import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import { MAX_QUEUE_DEPTH } from "@chatcoder/shared";

let h: TestHarness;
let sessionId: string;

beforeEach(async () => {
  h = await makeHarness();
  const { session } = await h.seedSession({ chatId: 1 });
  sessionId = session.id;
});
afterEach(async () => {
  await h.close();
});

describe("MessagesRepo enqueue + cap", () => {
  it("defaults resumeLastSession to true", async () => {
    await h.messages.enqueue({ sessionId, content: "msg-0" });
    const [m] = await h.messages.drain(sessionId);
    expect(m?.resumeLastSession).toBe(true);
  });

  it("stores resumeLastSession=false when requested", async () => {
    await h.messages.enqueue({ sessionId, content: "msg-0", resumeLastSession: false });
    const [m] = await h.messages.drain(sessionId);
    expect(m?.resumeLastSession).toBe(false);
  });

  it("enqueues and retains FIFO", async () => {
    for (let i = 0; i < 3; i++) {
      h.advanceTime(1);
      await h.messages.enqueue({ sessionId, content: `msg-${i}` });
    }
    const all = await h.messages.drain(sessionId);
    expect(all.map((m) => m.content)).toEqual(["msg-0", "msg-1", "msg-2"]);
  });

  it("caps at MAX_QUEUE_DEPTH by dropping oldest", async () => {
    for (let i = 0; i < MAX_QUEUE_DEPTH + 3; i++) {
      h.advanceTime(1);
      await h.messages.enqueue({ sessionId, content: `msg-${i}` });
    }
    const drained = await h.messages.drain(sessionId);
    expect(drained).toHaveLength(MAX_QUEUE_DEPTH);
    expect(drained[0]!.content).toBe("msg-3"); // 0,1,2 dropped
    expect(drained.at(-1)!.content).toBe(`msg-${MAX_QUEUE_DEPTH + 2}`);
  });

  it("reports droppedOldestId when capped", async () => {
    const drops: Array<string | null> = [];
    for (let i = 0; i < MAX_QUEUE_DEPTH + 2; i++) {
      h.advanceTime(1);
      const r = await h.messages.enqueue({ sessionId, content: `m${i}` });
      drops.push(r.droppedOldestId);
    }
    // First MAX_QUEUE_DEPTH enqueues → null, after that → non-null.
    expect(drops.slice(0, MAX_QUEUE_DEPTH).every((d) => d === null)).toBe(true);
    expect(drops.slice(MAX_QUEUE_DEPTH).every((d) => d !== null)).toBe(true);
  });
});

describe("MessagesRepo drain", () => {
  it("drain empties and deletes", async () => {
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, content: "A" });
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, content: "B" });
    const first = await h.messages.drain(sessionId);
    expect(first.map((m) => m.content)).toEqual(["A", "B"]);
    expect(await h.messages.count(sessionId)).toBe(0);
  });

  it("drain returns empty array when nothing queued", async () => {
    expect(await h.messages.drain(sessionId)).toEqual([]);
  });
});

describe("MessagesRepo processing lifecycle", () => {
  it("claims only one in-progress message per session", async () => {
    await h.messages.enqueue({ sessionId, content: "A" });
    await h.messages.enqueue({ sessionId, content: "B" });

    const first = await h.messages.claimNext(sessionId);
    expect(first?.content).toBe("A");
    expect(first?.processingStartedAt).toBe(h.now());
    expect(await h.messages.claimNext(sessionId)).toBeNull();
    expect(await h.messages.count(sessionId)).toBe(1);

    const processing = await h.messages.getProcessing(sessionId);
    expect(processing?.content).toBe("A");
    expect(await h.messages.completeProcessing(sessionId)).toBe(true);

    const second = await h.messages.claimNext(sessionId);
    expect(second?.content).toBe("B");
  });
});

describe("MessagesRepo.purgeSession", () => {
  it("removes all messages for a session", async () => {
    h.advanceTime(1);
    await h.messages.enqueue({ sessionId, content: "a" });
    await h.messages.purgeSession(sessionId);
    expect(await h.messages.count(sessionId)).toBe(0);
  });
});
