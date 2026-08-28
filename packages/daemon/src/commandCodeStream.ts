/**
 * Command Code (`cmd -p --output-format json`) emits NDJSON on stdout: a stream
 * of `{"type":"event","event":{...}}` lines followed by a single terminal
 * `{"type":"result","subtype":"success","finalText":"..."}` line.
 *
 * The runner-side progress pipeline (`sessionRunner` / `profileRunner`) only
 * knows how to forward raw text chunks via `onOutput` and treat the resolved
 * value as the final answer. This translator bridges the two: it consumes the
 * NDJSON stream, surfaces a human-readable progress string (the latest
 * assistant text + tool-running notes) for `onOutput`, and exposes the final
 * `finalText` on close.
 *
 * Why a separate file: the translator has no daemon/Telegram dependencies, so
 * it can be unit-tested directly without spawning a real `cmd` binary.
 */

export interface CommandCodeStreamResult {
  /** The assistant's final text from the terminal `result` line, or "" if absent. */
  finalText: string;
  /** True iff a `result` line was observed. */
  hasResult: boolean;
}

export interface CommandCodeStreamTranslator {
  /**
   * Feed a raw chunk of cmd stdout (may contain partial or multiple NDJSON
   * lines). Returns the *delta* of human-readable progress to forward to
   * `onOutput` (the new text since the last call), or "" if nothing new.
   */
  ingest(chunk: string): string;
  /** Snapshot the current progress view (used on close as a safety net). */
  snapshot(): string;
  /** Resolve the final result once the child has exited. */
  finalize(): CommandCodeStreamResult;
}

const TOOL_RUNNING_NOTE = (name: string, description: string | null): string => {
  const what = description && description.trim().length > 0 ? description.trim() : name;
  return `\n\n[tool: ${what}]`;
};

const TOOL_COMPLETED_NOTE = (name: string): string => `\n\n[tool: ${name} done]`;

/**
 * Build a translator for one `cmd --output-format json` run.
 *
 * The progress string is the latest assistant `text` we've seen, optionally
 * suffixed with a one-line note when a tool starts/finishes. We emit only the
 * delta (new characters since the last call) so the runner's 5-second flush
 * loop shows just the new text instead of the whole accumulated log every tick.
 */
export function createCommandCodeStreamTranslator(): CommandCodeStreamTranslator {
  let buffer = "";
  let currentText = "";
  let emittedTextLen = 0;
  let lastSuffix = "";
  let result: CommandCodeStreamResult = { finalText: "", hasResult: false };

  const snapshot = (): string => `${currentText}${lastSuffix}`;

  const finalize = (): CommandCodeStreamResult => result;

  const emitDelta = (): string => {
    const fullSnapshot = snapshot();
    if (fullSnapshot.length <= emittedTextLen) return "";
    const delta = fullSnapshot.slice(emittedTextLen);
    emittedTextLen = fullSnapshot.length;
    return delta;
  };

  const ingest = (chunk: string): string => {
    if (chunk.length === 0) return "";
    buffer += chunk;
    let emitted = "";
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        const lineEmitted = ingestLine(line);
        if (lineEmitted.length > 0) emitted += lineEmitted;
      }
      newlineIdx = buffer.indexOf("\n");
    }
    // Also flush whatever progress has accumulated even if the last line
    // hasn't terminated yet — the runner flushes every 5s and the user
    // should see the in-progress text without waiting for a newline.
    const tailDelta = emitDelta();
    if (tailDelta.length > 0) emitted += tailDelta;
    return emitted;
  };

  const ingestLine = (line: string): string => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Non-JSON line (e.g. cmd boot banner before it switches to NDJSON).
      // Surface it as a small note so the user sees the binary responded.
      const note = line.length > 0 ? `\n${line}` : "";
      if (note.length > 0) {
        lastSuffix = note;
        return emitDelta();
      }
      return "";
    }
    if (!parsed || typeof parsed !== "object") return "";
    const obj = parsed as Record<string, unknown>;
    if (obj["type"] === "result") {
      const finalText = typeof obj["finalText"] === "string" ? (obj["finalText"] as string) : "";
      result = { finalText, hasResult: true };
      // Don't emit anything new — the final result is returned separately.
      return "";
    }
    if (obj["type"] !== "event") return "";
    const event = obj["event"];
    if (!event || typeof event !== "object") return "";
    const ev = event as Record<string, unknown>;
    const evType = ev["type"];
    switch (evType) {
      case "text_delta": {
        if (typeof ev["delta"] === "string") {
          currentText += ev["delta"] as string;
          return emitDelta();
        }
        return "";
      }
      case "message_update": {
        // Snapshot of the full assistant text up to this point. Replaces
        // (rather than appends to) currentText so a partial duplicate of the
        // text_delta stream doesn't double-up the content.
        const content = ev["content"];
        if (Array.isArray(content)) {
          const joined = extractAssistantText(content);
          if (joined !== null) {
            currentText = joined;
            return emitDelta();
          }
        }
        return "";
      }
      case "tool_queued":
      case "tool_running": {
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        const description =
          ev["description"] !== undefined && ev["description"] !== null
            ? (ev["description"] as string)
            : null;
        lastSuffix = TOOL_RUNNING_NOTE(name, description);
        return emitDelta();
      }
      case "tool_completed": {
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        lastSuffix = TOOL_COMPLETED_NOTE(name);
        return emitDelta();
      }
      case "message_end": {
        // Authoritative final text for the current assistant message.
        const content = ev["content"];
        if (Array.isArray(content)) {
          const joined = extractAssistantText(content);
          if (joined !== null) {
            currentText = joined;
            return emitDelta();
          }
        }
        return "";
      }
      case "run_end": {
        const innerResult = ev["result"];
        if (innerResult && typeof innerResult === "object") {
          const finalText = (innerResult as Record<string, unknown>)["finalText"];
          if (typeof finalText === "string") {
            currentText = finalText as string;
            result = { finalText: currentText, hasResult: true };
            return emitDelta();
          }
        }
        return "";
      }
      default:
        return "";
    }
  };

  return { ingest, snapshot, finalize };
}

/**
 * Walk a `content` array (assistant message parts) and return the concatenated
 * text, or `null` if there are no text parts to extract.
 */
function extractAssistantText(content: unknown[]): string | null {
  let out = "";
  let saw = false;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p["type"] === "text" && typeof p["text"] === "string") {
      out += p["text"] as string;
      saw = true;
    }
  }
  return saw ? out : null;
}
