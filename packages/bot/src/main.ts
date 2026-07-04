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

  const telegram: TelegramSender = {
    async sendResponse(chatId, content) {
      for (const chunk of splitForTelegram(content)) {
        await sendTelegramWithRetry(() =>
          bot.api.sendMessage(chatId, chunk, { reply_markup: mainMenu(), parse_mode: "MarkdownV2" })
        );
      }
    },
    async sendProcessing(chatId, content) {
      await sendTelegramWithRetry(() =>
        bot.api.sendMessage(chatId, processingMessageText(content), {
          reply_markup: mainMenu()
        })
      );
    },
    async sendProcessed(chatId) {
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
