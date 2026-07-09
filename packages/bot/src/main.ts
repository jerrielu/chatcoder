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
  processingMessageText,
  sendTelegramWithRetry,
  splitForTelegram,
  type TelegramSender
} from "./bot/telegramSend.js";
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
   * Tracks the Telegram message we sent for a session while it is being
   * processed. Later calls (sendResponse / sendProcessed) edit this same
   * message instead of flooding the chat with new ones.
   */
  const processingStates = new Map<string, { messageId: number; content: string }>();

  const telegram: TelegramSender = {
    async sendResponse(chatId, content, sessionId) {
      const state = processingStates.get(sessionId);
      const chunks = splitForTelegram(content);

      for (let i = 0; i < chunks.length; i++) {
        if (i === 0 && state) {
          // Edit the "Daemon is processing…" message with the first chunk
          try {
            await sendTelegramWithRetry(() =>
              bot.api.editMessageText(chatId, state.messageId, chunks[0]!, {
                reply_markup: mainMenu(),
                parse_mode: "MarkdownV2"
              })
            );
            // Remember what we now show so sendProcessed can append to it
            processingStates.set(sessionId, { messageId: state.messageId, content: chunks[0]! });
            continue;
          } catch {
            // Edit failed (e.g. message deleted) – fall through to send as new
          }
        }
        await sendTelegramWithRetry(() =>
          bot.api.sendMessage(chatId, chunks[i]!, { reply_markup: mainMenu(), parse_mode: "MarkdownV2" })
        );
      }
    },

    async sendProcessing(chatId, content, sessionId) {
      const msg = await sendTelegramWithRetry(() =>
        bot.api.sendMessage(chatId, processingMessageText(content), {
          reply_markup: mainMenu()
        })
      );
      processingStates.set(sessionId, {
        messageId: msg.message_id,
        content: processingMessageText(content)
      });
    },

    async sendProcessed(chatId, sessionId) {
      const state = processingStates.get(sessionId);
      if (state) {
        // Try to append "✅ Message processed." to the existing message
        const newContent = state.content + "\n\n✅ Message processed.";
        try {
          await sendTelegramWithRetry(() =>
            bot.api.editMessageText(chatId, state.messageId, newContent, {
              reply_markup: mainMenu()
            })
          );
          return;
        } catch {
          // Edit failed – fall through to send as new message below
        }
      }
      // Fallback: send a fresh message
      await sendTelegramWithRetry(() =>
        bot.api.sendMessage(chatId, "✅ Message processed.", { reply_markup: mainMenu() })
      );
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
