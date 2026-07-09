#!/usr/bin/env node
import pino from "pino";
import { loadConfigFromEnv } from "./config.js";
import { openDb } from "./db/index.js";
import { ApiKeysRepo } from "./db/apiKeys.js";
import { ProfilesRepo } from "./db/profiles.js";
import { SessionsRepo } from "./db/sessions.js";
import { MessagesRepo } from "./db/messages.js";
import { AdminRepo } from "./db/admin.js";
import { buildServer } from "./api/server.js";
import { createBot } from "./bot/bot.js";
import { FlowStore } from "./bot/flows.js";
import { deriveLocalApiUrl } from "./apiUrl.js";
import {
  escapeMarkdownV2,
  sendTelegramWithRetry,
  splitForTelegram,
  type TelegramSender
} from "./bot/telegramSend.js";
import { InputFile } from "grammy";
import { mainMenu } from "./bot/menus.js";

async function main(): Promise<void> {
  const cfg = loadConfigFromEnv();
  const log = pino({ level: cfg.logLevel });

  const handle = await openDb(cfg.databaseUrl);
  const apiKeys = new ApiKeysRepo(handle.db);
  const profiles = new ProfilesRepo(handle.db);
  const sessions = new SessionsRepo(handle.db);
  const messages = new MessagesRepo(handle.db);
  const admin = new AdminRepo(handle.db);
  const flows = new FlowStore();

  const bot = createBot({
    telegramBotToken: cfg.telegramBotToken,
    apiKeys,
    profiles,
    sessions,
    messages,
    flows,
    heartbeatStaleMs: cfg.heartbeatStaleMs
  });

  /**
   * Tracks the Telegram message for a session while it is being processed.
   * The message uses a template with separate sections:
   *   - preview: the user's message (first 100 words)
   *   - progress: the latest live progress from the daemon (replaced each update)
   *   - response: the final response from the daemon (filled once)
   */
  interface ProcessingState {
    messageId: number;
    preview: string;
    progress: string;
    response: string;
  }
  const processingStates = new Map<string, ProcessingState>();

  /** Extract the first 100 words as a preview (same logic as processingMessageText). */
  function extractPreview(content: string): string {
    const words = content.trim().split(/\s+/).filter(Boolean);
    const preview = words.slice(0, 100).join(" ");
    const suffix = words.length > 100 ? "..." : "";
    return `${preview}${suffix}`;
  }

  /**
   * Build the template message from the state parts.
   * Non-response parts are escaped for MarkdownV2 so the whole message can
   * be sent with parse_mode=MarkdownV2 (the response part is already formatted
   * by the daemon via telegram-markdown-v2).
   */
  function buildProcessingMessage(state: ProcessingState): string {
    const escapedPreview = escapeMarkdownV2(state.preview);
    let msg = `🔄 Daemon is processing your message:\n${escapedPreview}`;
    if (state.progress) {
      msg += `\n\n⏳ Progress:\n${escapeMarkdownV2(state.progress)}`;
    }
    if (state.response) {
      msg += `\n\n✅ Response:\n${state.response}`;
    }
    return msg;
  }

  const telegram: TelegramSender = {
    async sendResponse(chatId, content, sessionId) {
      // Edit the processing message with the final response instead of sending
      // a new message, so the user sees the result in-place.
      const state = processingStates.get(sessionId);
      if (!state) {
        // Processing state already cleaned up — send as new message (fallback)
        const chunks = splitForTelegram(content);
        for (const chunk of chunks) {
          await sendTelegramWithRetry(() =>
            bot.api.sendMessage(chatId, chunk, { reply_markup: mainMenu(), parse_mode: "MarkdownV2" })
          );
        }
        return;
      }
      // Accumulate multi-chunk responses and edit in-place
      state.response = state.response ? state.response + content : content;
      try {
        await sendTelegramWithRetry(() =>
          bot.api.editMessageText(chatId, state.messageId, buildProcessingMessage(state), {
            reply_markup: mainMenu(),
            parse_mode: "MarkdownV2"
          })
        );
      } catch {
        // Best-effort — final response still available via progress updates
      }

      // Attach the full response as a text document with caption "full logs"
      try {
        const fullResponse = state.response;
        const documentBuffer = Buffer.from(fullResponse, "utf-8");
        const inputFile = new InputFile(documentBuffer, "response.md");
        await sendTelegramWithRetry(() =>
          bot.api.sendDocument(chatId, inputFile, {
            caption: "full logs",
            reply_markup: mainMenu()
          })
        );
      } catch {
        // Best-effort — document attachment is not critical
      }
    },

    async sendProcessing(chatId, content, sessionId) {
      const state: ProcessingState = {
        messageId: 0,
        preview: extractPreview(content),
        progress: "",
        response: ""
      };
      const msg = await sendTelegramWithRetry(() =>
        bot.api.sendMessage(chatId, buildProcessingMessage(state), {
          reply_markup: mainMenu(),
          parse_mode: "MarkdownV2"
        })
      );
      state.messageId = msg.message_id;
      processingStates.set(sessionId, state);
    },

    async sendProcessed(chatId, sessionId) {
      await sendTelegramWithRetry(() =>
        bot.api.sendMessage(chatId, "✅ Message processed.", { reply_markup: mainMenu() })
      );
      processingStates.delete(sessionId);
    },

    async sendLatestProgress(chatId, content, sessionId) {
      const state = processingStates.get(sessionId);
      if (!state) return; // Nothing to edit
      state.progress = content;
      try {
        await sendTelegramWithRetry(() =>
          bot.api.editMessageText(chatId, state.messageId, buildProcessingMessage(state), {
            reply_markup: mainMenu(),
            parse_mode: "MarkdownV2"
          })
        );
      } catch {
        // Best-effort — progress updates are not critical
      }
    }
  };

  const app = await buildServer({
    apiKeysRepo: apiKeys,
    profilesRepo: profiles,
    sessionsRepo: sessions,
    messagesRepo: messages,
    adminRepo: admin,
    telegram,
    logger: { level: cfg.logLevel }
  });

  await app.listen({ host: cfg.listenHost, port: cfg.listenPort });
  const apiUrl = deriveLocalApiUrl(cfg.listenHost, cfg.listenPort);
  log.info({ host: cfg.listenHost, port: cfg.listenPort, url: apiUrl }, "bot API listening");
  // eslint-disable-next-line no-console
  console.log(`\n  🤖 Bot API:   ${apiUrl}`);
  // eslint-disable-next-line no-console
  console.log(`     Admin:     ${apiUrl}/v1/admin (loopback-only)`);
  if (process.env.DASHBOARD_URL) {
    // eslint-disable-next-line no-console
    console.log(`  🧭 Dashboard: ${process.env.DASHBOARD_URL}`);
  }
  // eslint-disable-next-line no-console
  console.log("");

  bot.start({
    onStart: (info) => log.info({ username: info.username }, "bot long-polling started"),
    drop_pending_updates: true
  }).catch((err) => log.error({ err }, "bot crashed"));

  const shutdown = async (sig: string): Promise<void> => {
    log.info({ sig }, "shutting down");
    try {
      await bot.stop();
      await app.close();
      await handle.close();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
