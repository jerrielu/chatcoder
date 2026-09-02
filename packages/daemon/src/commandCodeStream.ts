/**
 * Command Code (`cmd -p --output-format json`) emits NDJSON on stdout: a stream
 * of `{"type":"event","event":{...}}` lines followed by a single terminal
 * `{"type":"result","subtype":"success","finalText":"..."}` line.
 *
 * The runner-side progress pipeline (`sessionRunner` / `profileRunner`) only
 * knows how to forward raw text chunks via `onOutput` and treat the resolved
 * value as the final answer. This translator bridges the two: it consumes the
 * NDJSON stream, surfaces a human-readable progress string (only the assistant
 * `text` / `delta` content) for `onOutput`, and exposes the final text on close.
 */

export interface CommandCodeStreamResult {
  finalText: string;
  hasResult: boolean;
}

export interface CommandCodeStreamTranslator {
  ingest(chunk: string): string;
  snapshot(): string;
  finalize(): CommandCodeStreamResult;
}

export function createCommandCodeStreamTranslator(): CommandCodeStreamTranslator {
  let buffer = "";
  let currentText = "";
  let emittedTextLen = 0;
  let result: CommandCodeStreamResult = { finalText: "", hasResult: false };

  const snapshot = (): string => currentText;

  const finalize = (): CommandCodeStreamResult => {
    if (result.hasResult) return result;
    if (currentText.length > 0) return { finalText: currentText, hasResult: true };
    return result;
  };

  const emitDelta = (): string => {
    if (currentText.length <= emittedTextLen) return "";
    const delta = currentText.slice(emittedTextLen);
    emittedTextLen = currentText.length;
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
    const tailDelta = emitDelta();
    if (tailDelta.length > 0) emitted += tailDelta;
    return emitted;
  };

  const ingestLine = (line: string): string => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return "";
    }
    if (!parsed || typeof parsed !== "object") return "";
    const obj = parsed as Record<string, unknown>;
    if (obj["type"] === "result") {
      const finalText = typeof obj["finalText"] === "string" ? (obj["finalText"] as string) : "";
      if (finalText.length > 0) {
        result = { finalText, hasResult: true };
      } else if (currentText.length > 0) {
        result = { finalText: currentText, hasResult: true };
      } else {
        result = { finalText: "", hasResult: true };
      }
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
      case "message_update":
      case "message_end": {
        const content = ev["content"];
        if (Array.isArray(content)) {
          const joined = extractAssistantText(content);
          if (joined !== null) {
            if (joined === currentText) return "";
            if (joined.startsWith(currentText) && emittedTextLen === currentText.length) {
              currentText = joined;
              return emitDelta();
            }
            currentText = joined;
            if (emittedTextLen > currentText.length) {
              emittedTextLen = 0;
              const delta = currentText;
              emittedTextLen = currentText.length;
              return delta;
            }
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
