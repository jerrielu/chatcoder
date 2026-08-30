import { describe, it, expect } from "vitest";
import { createCommandCodeStreamTranslator } from "../src/commandCodeStream.js";

const line = (obj: unknown): string => JSON.stringify(obj);

describe("createCommandCodeStreamTranslator", () => {
  it("emits text_delta progress incrementally", () => {
    const t = createCommandCodeStreamTranslator();
    const out1 = t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Hi" } }) + "\n");
    const out2 = t.ingest(line({ type: "event", event: { type: "text_delta", delta: " there" } }) + "\n");
    expect(out1).toBe("Hi");
    expect(out2).toBe(" there");
    expect(t.snapshot()).toBe("Hi there");
    const finalised = t.finalize();
    expect(finalised.hasResult).toBe(false);
    expect(finalised.finalText).toBe("");
  });

  it("uses message_update as a snapshot, not an append", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Hi" } }) + "\n");
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: " there" } }) + "\n");
    t.ingest(
      line({
        type: "event",
        event: { type: "message_update", content: [{ type: "text", text: "Hi there" }] }
      }) + "\n"
    );
    expect(t.snapshot()).toBe("Hi there");
  });

  it("captures the finalText from the terminal result line", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Done." } }) + "\n");
    t.ingest(
      line({
        type: "result",
        subtype: "success",
        sessionId: "abc",
        finalText: "Done."
      }) + "\n"
    );
    const finalised = t.finalize();
    expect(finalised.hasResult).toBe(true);
    expect(finalised.finalText).toBe("Done.");
  });

  it("emits tool running and completed notes as suffix", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(
      line({
        type: "event",
        event: { type: "tool_queued", toolName: "shell_command", description: "List files" }
      }) + "\n"
    );
    expect(t.snapshot()).toContain("[tool: List files]");
    t.ingest(
      line({
        type: "event",
        event: { type: "tool_completed", toolName: "shell_command" }
      }) + "\n"
    );
    expect(t.snapshot()).toContain("[tool: shell_command done]");
  });

  it("emits deltas only for new content (does not re-emit the full snapshot every chunk)", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Hello" } }) + "\n");
    // Re-feed the same text (simulates a duplicate message_update after a model_request_end)
    t.ingest(
      line({
        type: "event",
        event: { type: "message_update", content: [{ type: "text", text: "Hello" }] }
      }) + "\n"
    );
    // Snapshot didn't grow, so no new delta should be emitted
    const tail = t.ingest("");
    expect(tail).toBe("");
  });

  it("handles partial-line chunks across multiple ingest calls", () => {
    const t = createCommandCodeStreamTranslator();
    const json = line({ type: "event", event: { type: "text_delta", delta: "split" } });
    const part1 = json.slice(0, 15);
    const part2 = json.slice(15) + "\n";
    const out1 = t.ingest(part1);
    const out2 = t.ingest(part2);
    expect(out1 + out2).toContain("split");
    expect(t.snapshot()).toBe("split");
  });

  it("ignores non-JSON lines silently (boot banner etc.)", () => {
    const t = createCommandCodeStreamTranslator();
    const out = t.ingest("Command Code v1.37.0 starting...\n");
    expect(out).toContain("Command Code v1.37.0");
    expect(t.snapshot()).toContain("Command Code v1.37.0");
  });

  it("surfaces meta events as a heartbeat suffix", () => {
    const t = createCommandCodeStreamTranslator();
    const events = [
      "run_start",
      "turn_start",
      "message_start",
      "model_request_start",
      "model_trace",
      "api_retry"
    ] as const;
    for (const evType of events) {
      const out = t.ingest(line({ type: "event", event: { type: evType } }) + "\n");
      expect(out).toContain(`[${evType}]`);
      expect(t.snapshot()).toContain(`[${evType}]`);
    }
  });

  it("deduplicates repeating heartbeat events", () => {
    const t = createCommandCodeStreamTranslator();
    // First model_trace → emits a delta
    const first = t.ingest(line({ type: "event", event: { type: "model_trace" } }) + "\n");
    expect(first).toContain("[model_trace]");
    // Same model_trace again — no new delta should be emitted (snapshot unchanged)
    const second = t.ingest(line({ type: "event", event: { type: "model_trace" } }) + "\n");
    expect(second).toBe("");
  });

  it("clears the heartbeat suffix when real text_delta arrives", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "model_trace" } }) + "\n");
    expect(t.snapshot()).toContain("[model_trace]");
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Hi" } }) + "\n");
    expect(t.snapshot()).not.toContain("[model_trace]");
    expect(t.snapshot()).toBe("Hi");
  });

  it("does not clear a tool-running suffix when text_delta arrives", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(
      line({
        type: "event",
        event: { type: "tool_running", toolName: "shell_command", description: "ls" }
      }) + "\n"
    );
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Running" } }) + "\n");
    const snap = t.snapshot();
    expect(snap).toContain("[tool: ls]");
    expect(snap).toContain("Running");
  });

  it("surfaces tool_update as a 'tool: X running' suffix", () => {
    const t = createCommandCodeStreamTranslator();
    const out = t.ingest(
      line({
        type: "event",
        event: { type: "tool_update", toolName: "shell_command", description: "ls" }
      }) + "\n"
    );
    expect(out).toContain("[tool: ls running]");
    expect(t.snapshot()).toContain("[tool: ls running]");
  });

  it("handles a full cmd run sequence end-to-end with progress", () => {
    // Mirrors the real output we observed: run_start / turn_start / model_trace /
    // api_retry / text_delta / message_update / tool_queued / tool_running /
    // tool_update / tool_completed / turn_end / run_end / result.
    const t = createCommandCodeStreamTranslator();
    const feed = (evType: string, extra: Record<string, unknown> = {}): string =>
      t.ingest(line({ type: "event", event: { type: evType, ...extra } }) + "\n");

    feed("run_start");
    feed("turn_start", { turnNumber: 1 });
    feed("message_start");
    feed("model_request_start", { model: "x" });
    feed("model_trace");
    feed("model_trace");
    feed("api_retry", { attempt: 1 });
    feed("text_delta", { delta: "I'll list" });
    feed("message_update", { content: [{ type: "text", text: "I'll list" }] });
    feed("text_delta", { delta: " files" });
    feed("tool_queued", { toolName: "shell_command" });
    feed("tool_running", { toolName: "shell_command", description: "ls" });
    feed("tool_update", { toolName: "shell_command", description: "ls" });
    feed("tool_completed", { toolName: "shell_command" });
    feed("turn_end", { turnNumber: 1, hadToolCalls: true });
    feed("run_end", { result: { finalText: "I'll list files" } });

    const snap = t.snapshot();
    expect(snap).toContain("I'll list files");
    expect(snap).toContain("[tool: shell_command done]");

    t.ingest(line({ type: "result", subtype: "success", finalText: "I'll list files" }) + "\n");
    const finalised = t.finalize();
    expect(finalised.hasResult).toBe(true);
    expect(finalised.finalText).toBe("I'll list files");
  });
});
