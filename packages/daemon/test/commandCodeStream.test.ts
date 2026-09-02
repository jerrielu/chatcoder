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
    expect(finalised.hasResult).toBe(true);
    expect(finalised.finalText).toBe("Hi there");
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

  it("ignores tool lifecycle events and does not emit them", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "hello" } }) + "\n");
    const out1 = t.ingest(
      line({
        type: "event",
        event: { type: "tool_queued", toolName: "shell_command", description: "List files" }
      }) + "\n"
    );
    const out2 = t.ingest(
      line({
        type: "event",
        event: { type: "tool_running", toolName: "shell_command", description: "List files" }
      }) + "\n"
    );
    const out3 = t.ingest(
      line({
        type: "event",
        event: { type: "tool_update", toolName: "shell_command", description: "List files" }
      }) + "\n"
    );
    const out4 = t.ingest(
      line({
        type: "event",
        event: { type: "tool_completed", toolName: "shell_command" }
      }) + "\n"
    );
    expect(out1).toBe("");
    expect(out2).toBe("");
    expect(out3).toBe("");
    expect(out4).toBe("");
    expect(t.snapshot()).toBe("hello");
  });

  it("emits deltas only for new content (does not re-emit the full snapshot every chunk)", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Hello" } }) + "\n");
    t.ingest(
      line({
        type: "event",
        event: { type: "message_update", content: [{ type: "text", text: "Hello" }] }
      }) + "\n"
    );
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

  it("ignores non-JSON lines", () => {
    const t = createCommandCodeStreamTranslator();
    const out = t.ingest("Command Code v1.37.0 starting...\n");
    expect(out).toBe("");
    expect(t.snapshot()).toBe("");
  });

  it("ignores heartbeat/meta events and does not emit them", () => {
    const t = createCommandCodeStreamTranslator();
    const events = [
      "run_start",
      "turn_start",
      "message_start",
      "model_request_start",
      "model_trace",
      "api_retry",
      "turn_end",
      "model_request_end",
      "thinking"
    ] as const;
    for (const evType of events) {
      const out = t.ingest(line({ type: "event", event: { type: evType } }) + "\n");
      expect(out).toBe("");
      expect(t.snapshot()).toBe("");
    }
    expect(t.finalize().hasResult).toBe(false);
  });

  it("does not surface heartbeat when text_delta arrives (only text)", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "model_trace" } }) + "\n");
    expect(t.snapshot()).toBe("");
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "Hi" } }) + "\n");
    expect(t.snapshot()).toBe("Hi");
  });

  it("handles a full cmd run sequence end-to-end with only text/delta", () => {
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
    expect(snap).toBe("I'll list files");

    t.ingest(line({ type: "result", subtype: "success", finalText: "I'll list files" }) + "\n");
    const finalised = t.finalize();
    expect(finalised.hasResult).toBe(true);
    expect(finalised.finalText).toBe("I'll list files");
  });

  it("finalize falls back to currentText when result has empty finalText", () => {
    const t = createCommandCodeStreamTranslator();
    t.ingest(line({ type: "event", event: { type: "text_delta", delta: "hello" } }) + "\n");
    t.ingest(line({ type: "result", subtype: "success", finalText: "" }) + "\n");
    const f = t.finalize();
    expect(f.hasResult).toBe(true);
    expect(f.finalText).toBe("hello");
  });
});
