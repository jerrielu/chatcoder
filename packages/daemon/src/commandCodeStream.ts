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
 * The progress string is the latest assistant `text` we've seen, suffixed by
 * (a) an optional tool-running/completed note and/or (b) a heartbeat note from
 * meta events (model_trace, turn_start, api_retry, …) that cmd emits during the
 * model-thinking phase. Both suffixes are independent: changing one does not
 * clobber the other. We emit only the delta (new characters since the last
 * call) so the runner's 5-second flush loop shows just the new text instead of
 * the whole accumulated log every tick.
 */
export function createCommandCodeStreamTranslator(): CommandCodeStreamTranslator {
  let buffer = "";
  let currentText = "";
  let emittedTextLen = 0;
  let heartbeatSuffix = "";
  let toolSuffix = "";
  let result: CommandCodeStreamResult = { finalText: "", hasResult: false };

  const snapshot = (): string => `${currentText}${heartbeatSuffix}${toolSuffix}`;

  const finalize = (): CommandCodeStreamResult => result;

  /**
   * Emit the delta since the last emission. When text_delta extends
   * `currentText`, the common-prefix slice works naturally. When a suffix
   * changes shape, the caller should use `emitSuffixFromCurrentText`
   * instead so the prefix-change characters are not dropped.
   */
  const emitDelta = (): string => {
    const fullSnapshot = snapshot();
    const visibleSuffix = fullSnapshot.slice(currentText.length);
    const prevSuffixLen = emittedTextLen - currentText.length;
    if (prevSuffixLen < 0) {
      // currentText grew past emittedTextLen (typical for text_delta).
      // Emit the new text + any suffix, then resync.
      const newTextPortion = currentText.slice(emittedTextLen);
      emittedTextLen = fullSnapshot.length;
      return newTextPortion + visibleSuffix;
    }
    if (visibleSuffix === "" && emittedTextLen >= currentText.length) {
      return "";
    }
    if (fullSnapshot.length <= emittedTextLen) {
      // Snapshot didn't grow — suffix unchanged and nothing to add.
      return "";
    }
    const delta = fullSnapshot.slice(emittedTextLen);
    emittedTextLen = fullSnapshot.length;
    return delta;
  };

  /**
   * Force-emit the full visible suffix (heartbeat + tool) starting from
   * `currentText`. Used when a suffix changes shape (e.g. `[model_trace]`
   * → `[api_retry]`) where the simple slice-emit would drop the prefix-
   * change characters. At worst we re-send ~30 chars; correctness wins
   * over micro-optimisation here.
   */
  const emitSuffixFromCurrentText = (): string => {
    const fullSnapshot = snapshot();
    const tail = fullSnapshot.slice(currentText.length);
    if (tail.length === 0) return "";
    emittedTextLen = fullSnapshot.length;
    return tail;
  };

  const setHeartbeatSuffix = (next: string): string => {
    if (heartbeatSuffix === next) return "";
    heartbeatSuffix = next;
    return emitSuffixFromCurrentText();
  };

  const setToolSuffix = (next: string): string => {
    if (toolSuffix === next) return "";
    toolSuffix = next;
    return emitSuffixFromCurrentText();
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
      if (note.length > 0) return setHeartbeatSuffix(note);
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
          // Real assistant text is flowing — clear any stale heartbeat so
          // the user only sees the heartbeat during silence.
          if (heartbeatSuffix !== "") heartbeatSuffix = "";
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
            // Authoritative text snapshot — clear any stale heartbeat.
            if (heartbeatSuffix !== "") heartbeatSuffix = "";
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
        return setToolSuffix(TOOL_RUNNING_NOTE(name, description));
      }
      case "tool_completed": {
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        return setToolSuffix(TOOL_COMPLETED_NOTE(name));
      }
      case "tool_update": {
        // Mid-tool progress from cmd — shows the tool is alive but has not
        // finished yet. Uses the same shape as tool_running so the user
        // sees a consistent "[tool: … running]" note.
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        const description =
          ev["description"] !== undefined && ev["description"] !== null
            ? (ev["description"] as string)
            : null;
        const what = description && description.trim().length > 0 ? description.trim() : name;
        return setToolSuffix(`\n\n[tool: ${what} running]`);
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
      case "turn_start":
      case "turn_end":
      case "message_start":
      case "model_request_start":
      case "model_request_end":
      case "run_start":
      case "api_retry":
      case "model_trace":
      case "thinking": {
        // Heartbeat events: cmd emits these throughout the agent loop
        // (every 1-2 s during model inference, on retry, on turn boundaries).
        // Without them the Telegram "🔄 processing…" message appears frozen
        // for the whole model-thinking phase. setHeartbeatSuffix() dedupes
        // so a repeating model_trace doesn't spam a delta every second.
        return setHeartbeatSuffix(`\n[${String(evType)}]`);
      }
      default: {
        // Any future event type from cmd — surface as a heartbeat so the
        // user is never left staring at a frozen "🔄" while cmd is healthy.
        return setHeartbeatSuffix(`\n[${String(evType)}]`);
      }
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
