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
const truncate = (value: string, max = 120): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;
const summarizeInput = (input: unknown): string => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  const parts = keys.slice(0, 5).map((key) => {
    const v = obj[key];
    let val: string;
    if (typeof v === "string") val = truncate(v, 60);
    else if (typeof v === "number" || typeof v === "boolean") val = String(v);
    else if (Array.isArray(v)) val = `[${v.length}]`;
    else if (v && typeof v === "object") val = "{…}";
    else val = String(v);
    return `${key}=${val}`;
  });
  return `{${parts.join(", ")}}`;
};
const eventDetails = (ev: Record<string, unknown>): string => {
  const skip = new Set(["type"]);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(ev)) {
    if (skip.has(key) || value === null || value === undefined) continue;
    if (typeof value === "string") parts.push(`${key}=${truncate(value, 60)}`);
    else if (typeof value === "number" || typeof value === "boolean") parts.push(`${key}=${value}`);
    else if (Array.isArray(value)) parts.push(`${key}=[${value.length}]`);
    else if (typeof value === "object") parts.push(`${key}={…}`);
  }
  return parts.join(", ");
};
const extractToolResultText = (res: unknown): string => {
  if (typeof res === "string") {
    try {
      const parsed = JSON.parse(res);
      if (Array.isArray(parsed)) {
        return parsed
          .map((p) => {
            if (typeof p === "string") return p;
            if (p && typeof p === "object" && typeof (p as Record<string, unknown>)["text"] === "string")
              return (p as Record<string, unknown>)["text"] as string;
            return "";
          })
          .join("");
      }
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>)["text"] === "string")
        return (parsed as Record<string, unknown>)["text"] as string;
    } catch {
      // not JSON; fall through
    }
    return res;
  }
  if (Array.isArray(res)) {
    return res
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && typeof (p as Record<string, unknown>)["text"] === "string")
          return (p as Record<string, unknown>)["text"] as string;
        return "";
      })
      .join("");
  }
  if (res && typeof res === "object" && typeof (res as Record<string, unknown>)["text"] === "string")
    return (res as Record<string, unknown>)["text"] as string;
  if (res === undefined) return "";
  try { return JSON.stringify(res); } catch { return String(res); }
};
export function createCommandCodeStreamTranslator(): CommandCodeStreamTranslator {
  let buffer = "";
  let currentText = "";
  let emittedTextLen = 0;
  let result: CommandCodeStreamResult = { finalText: "", hasResult: false };
  let lastHeartbeat = "";
  let lastToolNote = "";
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
  const heartbeat = (label: string): string => {
    if (label.length === 0) return "";
    const token = `\n${label}`;
    if (token === lastHeartbeat) return "";
    lastHeartbeat = token;
    return token;
  };
  const toolNote = (note: string): string => {
    if (note.length === 0) return "";
    const token = `\n${note}`;
    if (token === lastToolNote) return "";
    lastToolNote = token;
    return token;
  };
  const resetSuffixes = (): void => { lastHeartbeat = ""; lastToolNote = ""; };
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
    try { parsed = JSON.parse(line); } catch { return ""; }
    if (!parsed || typeof parsed !== "object") return "";
    const obj = parsed as Record<string, unknown>;
    if (obj["type"] === "result") {
      const finalText = typeof obj["finalText"] === "string" ? (obj["finalText"] as string) : "";
      if (finalText.length > 0) result = { finalText, hasResult: true };
      else if (currentText.length > 0) result = { finalText: currentText, hasResult: true };
      else result = { finalText: "", hasResult: true };
      return "";
    }
    if (obj["type"] !== "event") return "";
    const event = obj["event"];
    if (!event || typeof event !== "object") return "";
    const ev = event as Record<string, unknown>;
    const evType = ev["type"];
    const strType = typeof evType === "string" ? evType : String(evType);
    switch (strType) {
      case "text_delta": {
        if (typeof ev["delta"] === "string") {
          currentText += ev["delta"] as string;
          resetSuffixes();
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
            resetSuffixes();
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
            resetSuffixes();
            return emitDelta();
          }
        }
        return "";
      }
      case "tool_queued": {
        const inputSummary = summarizeInput(ev["input"]);
        return toolNote(inputSummary);
      }
      case "tool_running":
      case "tool_update": {
        const desc = ev["description"];
        const partial = ev["partial"];
        let note = "";
        if (typeof desc === "string" && desc.length > 0) note = truncate(desc, 120);
        else if (typeof partial === "string" && partial.length > 0) note = truncate(partial, 120);
        return toolNote(note);
      }
      case "tool_completed": {
        const res = ev["result"];
        const text = extractToolResultText(res);
        return toolNote(text.length > 0 ? truncate(text, 120) : "");
      }
      case "tool_errored": {
        const err = ev["error"];
        const errStr = typeof err === "string" ? err : err !== undefined ? JSON.stringify(err) : "";
        return toolNote(errStr.length > 0 ? truncate(errStr, 120) : "");
      }
      case "thinking_start": {
        return "";
      }
      case "thinking_delta": {
        const delta = typeof ev["delta"] === "string" ? ev["delta"] : typeof ev["text"] === "string" ? ev["text"] : "";
        return delta.length > 0 ? delta : "";
      }
      case "thinking_end": {
        const text = typeof ev["text"] === "string" ? ev["text"] : typeof ev["delta"] === "string" ? ev["delta"] : "";
        return text.length > 0 ? truncate(text, 120) : "";
      }
      case "model_request_start": {
        const model = ev["model"];
        return typeof model === "string" && model.length > 0 ? model : "";
      }
      case "model_request_end": {
        const model = ev["model"];
        const stopReason = ev["stopReason"];
        const parts: string[] = [];
        if (typeof model === "string" && model.length > 0) parts.push(model);
        if (typeof stopReason === "string" && stopReason.length > 0) parts.push(stopReason);
        return parts.length > 0 ? parts.join(" ") : "";
      }
      case "turn_start": {
        return "";
      }
      case "turn_end": {
        return "";
      }
      case "api_retry": {
        const error = ev["error"];
        return typeof error === "string" && error.length > 0 ? truncate(error, 80) : "";
      }
      case "notice": {
        const message = ev["message"];
        return typeof message === "string" && message.length > 0 ? truncate(message, 120) : "";
      }
      case "compaction_start": {
        return "";
      }
      case "compaction_done": {
        return "";
      }
      case "continuation_recovery": {
        return "";
      }
      case "run_start": {
        return "";
      }
      case "model_trace": {
        const msg = ev["message"] ?? ev["text"] ?? ev["trace"];
        return typeof msg === "string" && msg.length > 0 ? truncate(msg, 120) : "";
      }
      case "message_start":
      case "thinking": {
        return "";
      }
      default: {
        const details = eventDetails(ev);
        return details.length > 0 ? details : "";
      }
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