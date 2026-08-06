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
  stripMarkdownV2,
  sendTelegramWithRetry,
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

  /** Telegram's hard limit on message body text (sendMessage / editMessageText). */
  const TELEGRAM_MSG_LIMIT = 4096;

  /** Truncation marker appended when the response doesn't fit in the message body. */
  const TRUNCATION_MARKER = "\n\n\u2014 Truncated \u2014 full response in response.txt";

  const telegram: TelegramSender = {
    async sendResponse(chatId, content, sessionId) {
      // Send the final response as a NEW message, leaving the processing/progress
      // message untouched. The full text is accumulated in state.response so that
      // sendProcessed can attach it as response.txt.
      const state = processingStates.get(sessionId);
      if (state) {
        state.response = state.response ? state.response + content : content;
      }

      // Telegram's hard limit is 4096 chars per message — truncate if needed
      // and point to response.txt for the full text.
      let text: string;
      if (content.length <= TELEGRAM_MSG_LIMIT) {
        text = content;
      } else {
        const room = TELEGRAM_MSG_LIMIT - TRUNCATION_MARKER.length;
        text = content.slice(0, room) + TRUNCATION_MARKER;
      }

      try {
        await sendTelegramWithRetry(() =>
          bot.api.sendMessage(chatId, text, {
            reply_markup: mainMenu(),
            parse_mode: "MarkdownV2"
          })
        );
      } catch {
        // Best-effort — final response still available via response.txt
      }
    },

    async sendProcessing(chatId, content, sessionId) {
      // If we are already tracking a processing message for this session (e.g.
      // the daemon resumed an in-progress task but this bot never restarted),
      // don't post a second one — sendLatestProgress will keep editing the
      // existing message instead.
      if (processingStates.has(sessionId)) return;
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
      // Build the response.txt with only the final response content,
      // stripping MarkdownV2 escapes so the file is clean readable text.
      const state = processingStates.get(sessionId);
      if (state) {
        const mdContent = state.response
          ? stripMarkdownV2(state.response)
          : "";
        if (mdContent) {
          try {
            // Prepend UTF-8 BOM so viewers detect the encoding correctly
            const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
            const documentBuffer = Buffer.concat([BOM, Buffer.from(mdContent, "utf-8")]);
            const inputFile = new InputFile(documentBuffer, "response.txt");

            // Caption: truncated preview so the user sees the gist without
            // opening the file.  Telegram caption limit is 1024 chars.
            const captionMax = 1001;
            const truncated = mdContent.length > captionMax
              ? "…" + mdContent.slice(-(captionMax - 1))
              : mdContent;
            const caption = `✅ Message processed\n\n${truncated}`;

            await sendTelegramWithRetry(() =>
              bot.api.sendDocument(chatId, inputFile, {
                caption,
                reply_markup: mainMenu()
              })
            );
          } catch {
            // Best-effort — document attachment is not critical
          }
        }
      }
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
