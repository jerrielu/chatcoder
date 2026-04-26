/**
 * Pure handlers for the Telegram bot. Each receives `deps` + the relevant
 * pieces of the incoming update and returns the reply(s) the bot should send.
 */
import type { InlineKeyboard } from "grammy";
import {
  API_KEY_PREFIX,
  ApiError,
  CODEX_TOKEN_USAGE_COMMAND,
  MAX_INSTRUCTION_BYTES,
  MAX_QUEUE_DEPTH
} from "@chatcoder/shared";
import { hashApiKey, validateUserSuppliedKey } from "../db/crypto.js";
import type { ApiKeysRepo } from "../db/apiKeys.js";
import type { ProfilesRepo } from "../db/profiles.js";
import type { SessionsRepo } from "../db/sessions.js";
import type { MessagesRepo } from "../db/messages.js";
import type { FlowStore } from "./flows.js";
import {
  backToMenu,
  mainMenu,
  profilePickerMenu,
  toolIcon
} from "./menus.js";

export interface Reply {
  text: string;
  keyboard?: InlineKeyboard;
  forceReply?: boolean;
  inputPlaceholder?: string;
  parseMode?: "Markdown" | "HTML";
}

export interface HandlerDeps {
  apiKeys: ApiKeysRepo;
  profiles: ProfilesRepo;
  sessions: SessionsRepo;
  messages: MessagesRepo;
  flows: FlowStore;
  /** Heartbeat age (ms) above which the daemon is shown as offline. */
  heartbeatStaleMs?: number;
  now?: () => number;
}

const WELCOME =
  "👋 *Chatcoder*\n\n" +
  "I relay instructions to a `chatcoder coder` service running on your own machine.\n\n" +
  "• Tap *New Session* to link this chat to a coder profile.\n" +
  "• Tap *Code* to run with session resume, or *New Code* for a fresh run.\n" +
  "• Tap *Latest Progress* to check the current in-progress output.\n";

function firstWords(text: string, limit: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, limit).join(" ");
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[\]])/g, "\\$1");
}

/* =============== /start =============== */

export function handleStart(): Reply {
  return { text: WELCOME, keyboard: mainMenu(), parseMode: "Markdown" };
}

/* =============== Menu callback =============== */

export function handleMenu(): Reply {
  return { text: "Main menu", keyboard: mainMenu() };
}

export async function handleLatestProgress(
  deps: HandlerDeps,
  chatId: number
): Promise<Reply> {
  const session = await deps.sessions.getLatestActiveByChatId(chatId);
  if (!session) {
    return {
      text: "No active session. Tap *New Session* first.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  if (!session.latestMessage) {
    return {
      text: "No progress recorded yet.",
      keyboard: mainMenu()
    };
  }
  return {
    text: session.latestMessage,
    keyboard: mainMenu()
  };
}

export async function handleTokenUsage(
  deps: HandlerDeps,
  chatId: number
): Promise<Reply> {
  const session = await deps.sessions.getLatestActiveByChatId(chatId);
  if (!session) {
    return {
      text: "No active session. Tap *New Session* first.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const profile = await deps.profiles.getById(session.profileId);
  if (!profile) {
    return {
      text: "❌ Session profile not found. Tap *New Session* to relink.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  if (profile.tool !== "OPENAI") {
    return {
      text:
        "🧮 Token usage is only available for Codex profiles.\n\n" +
        `${toolIcon(profile.tool)} Current profile: \`${profile.name}\``,
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const pending = await deps.messages.count(session.id);
  if (pending >= MAX_QUEUE_DEPTH) {
    return {
      text: `❌ Queue full (${MAX_QUEUE_DEPTH} pending). Wait for your daemon to drain it.`,
      keyboard: mainMenu()
    };
  }
  await deps.messages.enqueue({
    sessionId: session.id,
    content: CODEX_TOKEN_USAGE_COMMAND,
    resumeLastSession: true
  });
  return {
    text: `🧮 Token usage request queued for \`${profile.name}\`.`,
    keyboard: mainMenu(),
    parseMode: "Markdown"
  };
}

/* =============== Status =============== */

export async function handleStatus(
  deps: HandlerDeps,
  chatId: number
): Promise<Reply> {
  const sessions = await deps.sessions.listActiveByChatId(chatId);
  if (sessions.length === 0) {
    return {
      text: "You have no active sessions. Tap *New Session* to create one.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const now = (deps.now ?? Date.now)();
  const staleMs = deps.heartbeatStaleMs ?? 60_000;
  const lines: string[] = [];
  for (const s of sessions) {
    const [profile, apiKey, pending, processing] = await Promise.all([
      deps.profiles.getById(s.profileId),
      deps.apiKeys.getById(s.apiKeyId),
      deps.messages.count(s.id),
      deps.messages.getProcessing(s.id)
    ]);
    if (!profile || !apiKey) continue;
    const hbMs = apiKey.lastHeartbeat;
    const alive =
      hbMs && now - hbMs < staleMs ? "🟢 online" : "🔴 offline";
    const hbText = hbMs
      ? `${Math.round((now - hbMs) / 1000)}s ago`
      : "never";
    const processingText = processing
      ? `\n  processing: _${escapeMarkdown(firstWords(processing.content, 20))}_`
      : "";
    lines.push(
      `${toolIcon(profile.tool)} *${profile.name}* \`${apiKey.apiKeyPrefix}…\`\n` +
        `  ${alive} (heartbeat ${hbText}) · pending *${pending}*/${MAX_QUEUE_DEPTH}` +
        processingText
    );
  }
  const text =
    `*Active sessions for this chat*\n\n` +
    lines.join("\n\n") +
    `\n\nUse *Code* (resume) or *New Code* (fresh) from the menu.`;
  return { text, keyboard: mainMenu(), parseMode: "Markdown" };
}

/* =============== New Session flow =============== */

export function handleNewSessionRequest(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  deps.flows.set(chatId, telegramUser, { kind: "awaiting_api_key" });
  return {
    text:
      "🔗 *Link a coder session*\n\n" +
      "Paste the API key from your `chatcoder coder --setup` flow (starts with `cc_`).\n" +
      "Reply with the API key.\n\n" +
      "Send `/cancel` to abort.",
    forceReply: true,
    inputPlaceholder: "Paste coder API key",
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

/**
 * Called when the user sends a text message while in the `awaiting_api_key`
 * state. Looks up the daemon by api_key hash, validates it has profiles,
 * and transitions to `awaiting_profile` with a picker.
 *
 * Returns null if the user isn't in this flow (so the plain-text fallback
 * can take over).
 */
export async function handleApiKeySubmission(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number,
  text: string
): Promise<Reply | null> {
  const state = deps.flows.get(chatId, telegramUser);
  const raw = normalizeApiKeyInput(text);
  if (state.kind !== "awaiting_api_key") {
    // Recover gracefully if the bot restarted mid-flow or the user pasted
    // the daemon key directly without tapping "New Session" first.
    if (!looksLikeDaemonApiKey(raw)) return null;
    deps.flows.set(chatId, telegramUser, { kind: "awaiting_api_key" });
  }
  try {
    validateUserSuppliedKey(raw);
  } catch (e) {
    return {
      text: `❌ ${(e as Error).message}\n\nPaste a valid key in the reply box, or send \`/cancel\`.`,
      parseMode: "Markdown"
    };
  }
  const apiKey = await deps.apiKeys.getByHash(hashApiKey(raw));
  if (!apiKey) {
    return {
      text:
        "❌ I don't know that API key.\n" +
        "Make sure `chatcoder coder --setup` has run and connected at least once.\n\n" +
        "Try again in the reply box, or send `/cancel`.",
      parseMode: "Markdown"
    };
  }
  if (apiKey.status === "revoked") {
    return {
      text:
        "❌ That API key has been revoked. Generate a new one in the daemon.\n\n" +
        "Paste another key in the reply box, or send `/cancel`.",
      parseMode: "Markdown"
    };
  }
  const profiles = await deps.profiles.listByApiKey(apiKey.id);
  if (profiles.length === 0) {
    return {
      text:
        "⚠️ This coder service hasn't registered any profiles yet. " +
        "Run `chatcoder coder --setup` and add at least one profile.\n\n" +
        "Paste another key in the reply box, or send `/cancel`.",
      parseMode: "Markdown"
    };
  }
  deps.flows.set(chatId, telegramUser, {
    kind: "awaiting_profile",
    apiKeyId: apiKey.id
  });
  return {
    text:
      `✅ Daemon \`${apiKey.apiKeyPrefix}…\` found. ` +
      `Pick a profile for this session:`,
    keyboard: profilePickerMenu(profiles),
    parseMode: "Markdown"
  };
}

function normalizeApiKeyInput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "`" || first === "'" || first === "\"") && last === first) {
      return trimmed.slice(1, -1).trim();
    }
  }
  // Users sometimes paste the key as "/cc_xxx", which Telegram treats as a
  // command-shaped string; treat it as the same key.
  if (trimmed.startsWith(`/${API_KEY_PREFIX}`)) return trimmed.slice(1);
  return trimmed;
}

function looksLikeDaemonApiKey(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX);
}

export async function handleProfilePicked(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number,
  profileId: string
): Promise<Reply> {
  const state = deps.flows.get(chatId, telegramUser);
  if (state.kind !== "awaiting_profile") {
    return {
      text: "This flow expired. Tap *New Session* to start over.",
      keyboard: mainMenu(),
      parseMode: "Markdown"
    };
  }
  const profile = await deps.profiles.getById(profileId);
  if (!profile || profile.apiKeyId !== state.apiKeyId) {
    return {
      text: "❌ Unknown profile. Tap *New Session* to start over.",
      keyboard: mainMenu()
    };
  }
  const session = await deps.sessions.create({
    chatId,
    apiKeyId: state.apiKeyId,
    profileId
  });
  deps.flows.clear(chatId, telegramUser);
  return {
    text:
      `✅ *Session linked.*\n` +
      `${toolIcon(profile.tool)} profile: \`${profile.name}\`\n` +
      `session id: \`${session.id.slice(0, 8)}\`\n\n` +
      `Use *Code* (resume) or *New Code* (fresh) from the menu to dispatch.`,
    keyboard: backToMenu(),
    parseMode: "Markdown"
  };
}

/* =============== Instruction flows =============== */

export function handleCodeRequest(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  deps.flows.set(chatId, telegramUser, {
    kind: "awaiting_instruction",
    resumeLastSession: true
  });
  return {
    text:
      "💻 *Code (resume)*\n\n" +
      "Enter the instruction for your daemon. This will resume the last CLI session.\n\n" +
      "Reply with the instruction, or send `/cancel` to abort.",
    forceReply: true,
    inputPlaceholder: "Describe the code change",
    parseMode: "Markdown"
  };
}

export function handleNewCodeRequest(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number
): Reply {
  deps.flows.set(chatId, telegramUser, {
    kind: "awaiting_instruction",
    resumeLastSession: false
  });
  return {
    text:
      "🆕 *New Code (fresh)*\n\n" +
      "Enter the instruction for your daemon. This will start a fresh CLI run.\n\n" +
      "Reply with the instruction, or send `/cancel` to abort.",
    forceReply: true,
    inputPlaceholder: "Describe the code change",
    parseMode: "Markdown"
  };
}

export async function handleInstructionSubmission(
  deps: HandlerDeps,
  chatId: number,
  telegramUser: number,
  text: string
): Promise<Reply | null> {
  const state = deps.flows.get(chatId, telegramUser);
  if (state.kind !== "awaiting_instruction") return null;

  const instruction = text.trim();
  if (instruction.length === 0) {
    return {
      text: "❌ Instruction cannot be empty. Enter a message or send `/cancel`.",
      parseMode: "Markdown"
    };
  }
  if (instruction.length > MAX_INSTRUCTION_BYTES) {
    return {
      text:
        `❌ Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.\n` +
        "Send a shorter instruction or `/cancel`.",
      parseMode: "Markdown"
    };
  }

  const reply = await handleCode(deps, chatId, instruction, state.resumeLastSession);
  deps.flows.clear(chatId, telegramUser);
  return reply;
}

export async function handleCode(
  deps: HandlerDeps,
  chatId: number,
  instruction: string,
  resumeLastSession = true
): Promise<Reply> {
  if (instruction.length === 0) {
    return { text: "❌ Instruction cannot be empty." };
  }
  if (instruction.length > MAX_INSTRUCTION_BYTES) {
    return {
      text: `❌ Instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes. Shorten and retry.`
    };
  }
  const session = await deps.sessions.getLatestActiveByChatId(chatId);
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
  const pending = await deps.messages.count(session.id);
  if (pending >= MAX_QUEUE_DEPTH) {
    return {
      text: `❌ Queue full (${MAX_QUEUE_DEPTH} pending). Wait for your daemon to drain it.`
    };
  }
  await deps.messages.enqueue({
    sessionId: session.id,
    content: instruction,
    resumeLastSession
  });
  await deps.sessions.setLatestMessage(session.id, null);
  const profile = await deps.profiles.getById(session.profileId);
  const suffix = profile ? ` → \`${profile.name}\`` : "";
  const mode = resumeLastSession ? "resume" : "fresh";
  return { text: `📥 Queued for daemon${suffix} (${mode}).`, parseMode: "Markdown" };
}

/* =============== Plain text fallback =============== */

export function handlePlainText(): Reply {
  return {
    text:
      "Use the menu buttons to send instructions:\n" +
      "• *Code* = resume last session\n" +
      "• *New Code* = fresh run",
    keyboard: mainMenu(),
    parseMode: "Markdown"
  };
}
