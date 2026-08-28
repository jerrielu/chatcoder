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
});
