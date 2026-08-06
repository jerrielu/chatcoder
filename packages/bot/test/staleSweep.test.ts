import { describe, it, expect, vi } from "vitest";
import { sweepStaleTasks, type StaleSweepDeps } from "../src/staleSweep.js";
import type { QueuedMessage } from "../src/db/messages.js";

const NOW = 1_000_000_000;

function processing(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: "msg-1",
    sessionId: "session-1",
    content: "fix the UI",
    kind: "instruction",
    resumeLastSession: true,
    processingStartedAt: NOW - 120_000,
    createdAt: NOW - 300_000,
    ...overrides
  };
}

function makeDeps(overrides: Partial<StaleSweepDeps> = {}): StaleSweepDeps {
  const completeProcessing = vi.fn().mockResolvedValue(true);
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  return {
    apiKeys: {
      list: vi.fn().mockResolvedValue([
        { id: "key-1", lastHeartbeat: NOW - 10_000 },
        { id: "key-2", lastHeartbeat: NOW - 300_000 } // stale
      ])
    },
    sessions: {
      listActiveByApiKey: vi.fn().mockResolvedValue([{ id: "session-1", chatId: 42 }])
    },
    messages: {
      getProcessing: vi
        .fn()
        .mockResolvedValueOnce(processing())
        .mockResolvedValueOnce(null),
      completeProcessing,
      enqueue,
    },
    staleAfterMs: 60_000,
    now: () => NOW,
    notify,
    ...overrides
  };
}

describe("sweepStaleTasks", () => {
  it("does nothing when the daemon heartbeat is fresh", async () => {
    const deps = makeDeps({
      apiKeys: {
        list: vi.fn().mockResolvedValue([{ id: "key-1", lastHeartbeat: NOW - 10_000 }])
      }
    });
    const count = await sweepStaleTasks(deps);
    expect(count).toBe(0);
    expect(deps.messages.completeProcessing).not.toHaveBeenCalled();
    expect(deps.messages.enqueue).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("skips keys that never heartbeated (no daemon ever)", async () => {
    const deps = makeDeps({
      apiKeys: {
        list: vi.fn().mockResolvedValue([{ id: "key-1", lastHeartbeat: null }])
      }
    });
    const count = await sweepStaleTasks(deps);
    expect(count).toBe(0);
    expect(deps.sessions.listActiveByApiKey).not.toHaveBeenCalled();
  });

  it("kills a stale in-progress task and re-queues it (rerun)", async () => {
    const deps = makeDeps();
    const count = await sweepStaleTasks(deps);

    expect(count).toBe(1);
    // Only the stale key's session was inspected.
    expect(deps.sessions.listActiveByApiKey).toHaveBeenCalledWith("key-2");
    // Stuck row killed, instruction re-queued with the same content/flags.
    expect(deps.messages.completeProcessing).toHaveBeenCalledWith("session-1");
    expect(deps.messages.enqueue).toHaveBeenCalledWith({
      sessionId: "session-1",
      content: "fix the UI",
      kind: "instruction",
      resumeLastSession: true
    });
    expect(deps.notify).toHaveBeenCalledWith(42, expect.stringContaining("re-queued"));
  });

  it("re-queues multiple stale tasks in one session", async () => {
    const getProcessing = vi
      .fn()
      .mockResolvedValueOnce(processing({ id: "msg-1" }))
      .mockResolvedValueOnce(processing({ id: "msg-2", content: "second" }))
      .mockResolvedValueOnce(null);
    const deps = makeDeps({ messages: { getProcessing, completeProcessing: vi.fn().mockResolvedValue(true), enqueue: vi.fn().mockResolvedValue(undefined) } });
    const count = await sweepStaleTasks(deps);
    expect(count).toBe(2);
    expect(deps.messages.completeProcessing).toHaveBeenCalledTimes(2);
    expect(deps.messages.enqueue).toHaveBeenCalledTimes(2);
  });

  it("preserves codexReasoningEffort when re-queuing", async () => {
    const deps = makeDeps({
      messages: {
        getProcessing: vi
          .fn()
          .mockResolvedValueOnce(
            processing({ id: "msg-1", codexReasoningEffort: "high" as const })
          )
          .mockResolvedValueOnce(null),
        completeProcessing: vi.fn().mockResolvedValue(true),
        enqueue: vi.fn().mockResolvedValue(undefined)
      }
    });
    await sweepStaleTasks(deps);
    expect(deps.messages.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ codexReasoningEffort: "high" })
    );
  });

  it("keeps sweeping even when the notification fails", async () => {
    const deps = makeDeps({ notify: vi.fn().mockRejectedValue(new Error("telegram down")) });
    const count = await sweepStaleTasks(deps);
    expect(count).toBe(1);
    expect(deps.messages.completeProcessing).toHaveBeenCalled();
    expect(deps.messages.enqueue).toHaveBeenCalled();
  });
});
