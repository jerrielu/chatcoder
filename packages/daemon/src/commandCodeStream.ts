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

export function createCommandCodeStreamTranslator(): CommandCodeStreamTranslator {
  let buffer = "";
  let currentText = "";
  let emittedTextLen = 0;
  let result: CommandCodeStreamResult = { finalText: "", hasResult: false };
  // Dedup slots for live-progress heartbeats / tool notes. These are emitted
  // to `onOutput` for liveness but never folded into `currentText`, so they
  // cannot leak into the final answer or `snapshot()`.
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
    const token = `\n[${label}]`;
    if (token === lastHeartbeat) return "";
    lastHeartbeat = token;
    return token;
  };

  const toolNote = (note: string): string => {
    const token = `\n${note}`;
    if (token === lastToolNote) return "";
    lastToolNote = token;
    return token;
  };

  const resetSuffixes = (): void => {
    lastHeartbeat = "";
    lastToolNote = "";
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
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        const inputSummary = summarizeInput(ev["input"]);
        return toolNote(inputSummary ? `[tool: ${name} ${inputSummary}]` : `[tool: ${name}]`);
      }
      case "tool_running":
      case "tool_update": {
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        const desc = ev["description"];
        const partial = ev["partial"];
        let suffix = "";
        if (typeof desc === "string" && desc.length > 0) suffix = `: ${truncate(desc, 120)}`;
        else if (typeof partial === "string" && partial.length > 0) suffix = `: ${truncate(partial, 120)}`;
        const state = strType === "tool_update" ? "update" : "running";
        return toolNote(`[tool: ${name} ${state}${suffix}]`);
      }
      case "tool_completed": {
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        const res = ev["result"];
        const resStr = typeof res === "string" ? res : res !== undefined ? JSON.stringify(res) : "";
        return toolNote(resStr.length > 0 ? `[tool: ${name} done: ${truncate(resStr, 120)}]` : `[tool: ${name} done]`);
      }
      case "tool_errored": {
        const name = typeof ev["toolName"] === "string" ? (ev["toolName"] as string) : "tool";
        const err = ev["error"];
        const errStr = typeof err === "string" ? err : err !== undefined ? JSON.stringify(err) : "";
        return toolNote(errStr.length > 0 ? `[tool: ${name} error: ${truncate(errStr, 120)}]` : `[tool: ${name} error]`);
      }
      case "thinking_start": {
        return heartbeat("thinking_start");
      }
      case "thinking_delta": {
        const delta = typeof ev["delta"] === "string" ? ev["delta"] : typeof ev["text"] === "string" ? ev["text"] : "";
        return heartbeat(delta.length > 0 ? `thinking_delta: ${truncate(delta, 80)}` : "thinking_delta");
      }
      case "thinking_end": {
        const text = typeof ev["text"] === "string" ? ev["text"] : typeof ev["delta"] === "string" ? ev["delta"] : "";
        return heartbeat(text.length > 0 ? `thinking_end: ${truncate(text, 120)}` : "thinking_end");
      }
      case "model_request_start": {
        const model = ev["model"];
        return heartbeat(typeof model === "string" && model.length > 0 ? `model_request_start: ${model}` : "model_request_start");
      }
      case "model_request_end": {
        const model = ev["model"];
        const stopReason = ev["stopReason"];
        const parts: string[] = [];
        if (typeof model === "string" && model.length > 0) parts.push(model);
        if (typeof stopReason === "string" && stopReason.length > 0) parts.push(stopReason);
        return heartbeat(parts.length > 0 ? `model_request_end: ${parts.join(" ")}` : "model_request_end");
      }
      case "turn_start": {
        const n = ev["turnNumber"];
        return heartbeat(typeof n === "number" ? `turn_start: ${n}` : "turn_start");
      }
      case "turn_end": {
        const n = ev["turnNumber"];
        const had = ev["hadToolCalls"];
        const parts: string[] = [];
        if (typeof n === "number") parts.push(String(n));
        if (typeof had === "boolean") parts.push(had ? "tools" : "no-tools");
        return heartbeat(parts.length > 0 ? `turn_end: ${parts.join(" ")}` : "turn_end");
      }
      case "api_retry": {
        const attempt = ev["attempt"];
        const delayMs = ev["delayMs"];
        const error = ev["error"];
        const parts: string[] = [];
        if (typeof attempt === "number") parts.push(`attempt ${attempt}`);
        if (typeof delayMs === "number") parts.push(`${delayMs}ms`);
        if (typeof error === "string" && error.length > 0) parts.push(truncate(error, 80));
        return heartbeat(parts.length > 0 ? `api_retry: ${parts.join(", ")}` : "api_retry");
      }
      case "notice": {
        const level = ev["level"];
        const message = ev["message"];
        const lvl = typeof level === "string" && level.length > 0 ? level : "info";
        if (typeof message === "string" && message.length > 0) {
          return heartbeat(`notice: ${lvl} ${truncate(message, 120)}`);
        }
        return heartbeat("notice");
      }
      case "compaction_start": {
        return heartbeat("compaction_start");
      }
      case "compaction_done": {
        const saved = ev["tokensSaved"];
        return heartbeat(typeof saved === "number" ? `compaction_done: saved ${saved}` : "compaction_done");
      }
      case "continuation_recovery": {
        const kind = ev["kind"];
        const attempt = ev["attempt"];
        const maxAttempts = ev["maxAttempts"];
        const parts: string[] = [];
        if (typeof kind === "string") parts.push(kind);
        if (typeof attempt === "number" && typeof maxAttempts === "number") parts.push(`${attempt}/${maxAttempts}`);
        return heartbeat(parts.length > 0 ? `continuation_recovery: ${parts.join(" ")}` : "continuation_recovery");
      }
      case "run_start": {
        const sessionId = ev["sessionId"];
        return heartbeat(typeof sessionId === "string" && sessionId.length > 0 ? `run_start: ${sessionId}` : "run_start");
      }
      case "model_trace": {
        const msg = ev["message"] ?? ev["text"] ?? ev["trace"];
        return heartbeat(typeof msg === "string" && msg.length > 0 ? `model_trace: ${truncate(msg, 120)}` : "model_trace");
      }
      case "message_start":
      case "thinking": {
        return heartbeat(strType);
      }
      default: {
        const details = eventDetails(ev);
        return heartbeat(details.length > 0 ? `${strType}: ${details}` : strType);
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