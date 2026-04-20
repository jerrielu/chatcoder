/**
 * Pure handlers for the Telegram bot. Each receives `deps` + the relevant
 * pieces of the incoming update and returns the reply(s) the bot should send.
 *
 * Decoupling handlers from grammY's Context object makes them trivial to unit
 * test and re-target (e.g. to a future webhook mode).
 */
import type { InlineKeyboard } from "grammy";
import {
  ApiError,
  MAX_INSTRUCTION_BYTES,
  MAX_QUEUE_DEPTH
} from "@chatcoder/shared";
import type { SessionsRepo } from "../db/sessions.js";
import type { MessagesRepo } from "../db/messages.js";
import type { FlowStore } from "./flows.js";
import {
  backToMenu,
  confirmRotationMenu,
  keyChoiceMenu,
  mainMenu
} from "./menus.js";

export interface Reply {
  text: string;
  keyboard?: InlineKeyboard;
  parseMode?: "Markdown" | "HTML";
}

export interface HandlerDeps {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  flows: FlowStore;
  publicApiUrl: string | undefined;
  /** Heartbeat age (ms) above which the daemon is shown as offline. */
  heartbeatStaleMs?: number;
  now?: () => number;
}

const WELCOME =
  "👋 *Chatcoder*\n\n" +
  "I relay instructions to a `chatcoder-daemon` running on your own machine.\n\n" +
  "• Tap *New Session* to generate credentials.\n" +
  "• Send `/code <your instruction>` to queue work.\n" +
  "• Tap *Response* to read what your daemon replied.\n";

/* =============== /start =============== */

export function handleStart(): Reply {
  return { text: WELCOME, keyboard: mainMenu(), parseMode: "Markdown" };
}

/* =============== Menu callback =============== */

export function handleMenu(): Reply {
  return { text: "Main menu", keyboard: mainMenu() };
}

/* =============== Status =============== */

export async function handleStatus(
  deps: HandlerDeps,
  chatId: number
): Promise<Reply> {
  const session = await deps.sessions.getActiveByChatId(chatId);
  if (!session) {
    return {
      text: "You have no active session. Tap *New Session* to create one.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const [pendInstr, pendResp] = await Promise.all([
    deps.messages.count(session.id, "to_daemon"),
    deps.messages.count(session.id, "to_user")
  ]);
  const now = (deps.now ?? Date.now)();
  const staleMs = deps.heartbeatStaleMs ?? 60_000;
  const hb = session.lastHeartbeat
    ? `${Math.round((now - session.lastHeartbeat) / 1000)}s ago`
    : "never";
  const alive = session.lastHeartbeat && now - session.lastHeartbeat < staleMs ? "🟢 online" : "🔴 offline";
  const text =
    `*Session* \`${session.apiKeyPrefix}…\`\n` +
    `Daemon: ${alive} (last heartbeat ${hb})\n` +
    `Pending instructions → daemon: *${pendInstr}* / ${MAX_QUEUE_DEPTH}\n` +
    `Pending responses → you: *${pendResp}* / ${MAX_QUEUE_DEPTH}`;
  return { text, keyboard: mainMenu(), parseMode: "Markdown" };
}

/* =============== Response =============== */

export async function handleResponse(
  deps: HandlerDeps,
  chatId: number
): Promise<Reply[]> {
  const session = await deps.sessions.getActiveByChatId(chatId);
  if (!session) {
    return [
      {
        text: "No active session. Tap *New Session*.",
        keyboard: mainMenu(),
        parseMode: "Markdown"
      }
    ];
  }
  const msgs = await deps.messages.drain(session.id, "to_user");
  if (msgs.length === 0) {
    return [
      {
        text: "No pending responses. Your daemon hasn't posted anything back yet.",
        keyboard: mainMenu()
      }
    ];
  }

  const combined = msgs.map((m) => m.content).join("\n---\n");
  const chunks = splitForTelegram(combined);

  return chunks.map((chunk, i) => ({
    text: i === 0 ? `📨 *Response*\n\n\`\`\`\n${chunk}\n\`\`\`` : `\`\`\`\n${chunk}\n\`\`\``,
    keyboard: i === chunks.length - 1 ? mainMenu() : undefined,
    parseMode: "Markdown"
  }));
}

/* =============== New Session (two-step) =============== */

export function handleNewSessionRequest(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  deps.flows.set(chatId, telegramUser, { kind: "confirming_rotation" });
  return {
    text:
      "⚠️ *Creating a new session will REVOKE your current session.*\n" +
      "Your daemon will stop accepting commands until you reconfigure it.\n\n" +
      "Are you sure?",
    keyboard: confirmRotationMenu(),
    parseMode: "Markdown"
  };
}

export function handleNewSessionConfirm(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  const s = deps.flows.get(chatId, telegramUser);
  if (s.kind !== "confirming_rotation") {
    return {
      text: "This confirmation expired. Tap *New Session* again.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  deps.flows.set(chatId, telegramUser, { kind: "awaiting_rotation_key" });
  return {
    text:
      "Send me an API key of your own (≥16 chars, no spaces), " +
      "or tap *Generate for me* and I'll make one.",
    keyboard: keyChoiceMenu(),
    parseMode: "Markdown"
  };
}

export function handleNewSessionCancel(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  deps.flows.clear(chatId, telegramUser);
  return { text: "Cancelled.", keyboard: mainMenu() };
}

export async function handleGenerateKey(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Promise<Reply> {
  const s = deps.flows.get(chatId, telegramUser);
  if (s.kind !== "awaiting_rotation_key") {
    return {
      text: "Flow expired. Tap *New Session* to start over.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const { rawApiKey } = await deps.sessions.rotate({ chatId });
  deps.flows.clear(chatId, telegramUser);
  return deliverNewKeyReply(rawApiKey, deps.publicApiUrl);
}

export async function handleUserSuppliedKey(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number,
  rawApiKey: string
): Promise<Reply | null> {
  const s = deps.flows.get(chatId, telegramUser);
  if (s.kind !== "awaiting_rotation_key") return null;
  try {
    const { rawApiKey: stored } = await deps.sessions.rotate({
      chatId,
      rawApiKey: rawApiKey.trim()
    });
    deps.flows.clear(chatId, telegramUser);
    return deliverNewKeyReply(stored, deps.publicApiUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid key";
    return {
      text: `❌ ${msg}\n\nTry again, or tap *Generate for me*.`,
      keyboard: keyChoiceMenu(),
      parseMode: "Markdown"
    };
  }
}

function deliverNewKeyReply(rawApiKey: string, publicApiUrl: string | undefined): Reply {
  const url = publicApiUrl ?? "https://<your-bot-api>";
  return {
    text:
      "✅ *Session created.* This key is shown once — copy it now.\n\n" +
      `\`\`\`\nAPI URL: ${url}\nAPI KEY: ${rawApiKey}\n\`\`\`\n\n` +
      "On your remote machine:\n" +
      "```\n" +
      "node packages/daemon/dist/main.js setup\n" +
      "node packages/daemon/dist/main.js run\n" +
      "```",
    keyboard: backToMenu(),
    parseMode: "Markdown"
  };
}

/* =============== /code instruction =============== */

const CODE_PATTERN = /^\/code(?:@\S+)?(?:\s+([\s\S]*))?$/;

/** Returns null when message isn't a /code command. */
export function parseCodeCommand(text: string): string | null {
  const m = CODE_PATTERN.exec(text);
  if (!m) return null;
  return (m[1] ?? "").trim();
}

export async function handleCode(
  deps: HandlerDeps,
  chatId: number,
  instruction: string
): Promise<Reply> {
  if (instruction.length === 0) {
    return {
      text: "Usage: `/code <instruction>`\nExample: `/code add tests for src/foo.ts`",
      parseMode: "Markdown"
    };
  }
  if (instruction.length > MAX_INSTRUCTION_BYTES) {
    return {
      text: `❌ Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes. Shorten and retry.`
    };
  }
  const session = await deps.sessions.getActiveByChatId(chatId);
  if (!session) {
    return {
      text: "No active session. Tap *New Session* first.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const ok = await deps.sessions.tryConsumeRate(session.id);
  if (!ok) {
    throw ApiError.rateLimited();
  }
  const pending = await deps.messages.count(session.id, "to_daemon");
  if (pending >= MAX_QUEUE_DEPTH) {
    return {
      text: `❌ Queue full (${MAX_QUEUE_DEPTH} pending). Wait for your daemon to drain it.`
    };
  }
  await deps.messages.enqueue({
    sessionId: session.id,
    direction: "to_daemon",
    content: instruction
  });
  return { text: "📥 Queued for daemon." };
}

/* =============== Plain text fallback =============== */

export function handlePlainText(): Reply {
  return {
    text:
      "To send an instruction to your daemon, prefix it with `/code`.\n" +
      "Example: `/code list failing tests`",
    keyboard: mainMenu(),
    parseMode: "Markdown"
  };
}

function splitForTelegram(s: string): string[] {
  // Telegram message cap is 4096 chars; we use a safe limit for Markdown overhead.
  const LIMIT = 3800;
  const chunks: string[] = [];
  let current = s;
  while (current.length > 0) {
    if (current.length <= LIMIT) {
      chunks.push(current);
      break;
    }
    // Try to split on a newline if possible.
    let splitAt = current.lastIndexOf("\n", LIMIT);
    if (splitAt < LIMIT * 0.8) splitAt = LIMIT; // fallback if no newline nearby
    chunks.push(current.slice(0, splitAt));
    current = current.slice(splitAt).trimStart();
  }
  return chunks;
}
