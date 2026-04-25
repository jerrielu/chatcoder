import { Bot, type Context } from "grammy";
import { ApiError, ERROR_CODES } from "@chatcoder/shared";
import type { HandlerDeps, Reply } from "./handlers.js";
import {
  handleApiKeySubmission,
  handleCodeRequest,
  handleInstructionSubmission,
  handleLatestProgress,
  handleMenu,
  handleNewCodeRequest,
  handleNewSessionCancel,
  handleNewSessionRequest,
  handlePlainText,
  handleProfilePicked,
  handleStart,
  handleStatus
} from "./handlers.js";
import { CB, parseProfileCallback } from "./menus.js";
import { sendTelegramWithRetry } from "./telegramSend.js";

export interface CreateBotOptions extends HandlerDeps {
  telegramBotToken: string;
}

export function createBot(opts: CreateBotOptions): Bot {
  const bot = new Bot(opts.telegramBotToken);
  wireBot(bot, opts);
  return bot;
}

/** Exported so tests can wire a mock Bot. */
export function wireBot(bot: Bot, deps: HandlerDeps): void {
  bot.command("start", async (ctx) => {
    await send(ctx, handleStart());
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewSessionCancel(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.menu, async (ctx) => {
    await ctx.answerCallbackQuery();
    await send(ctx, handleMenu());
  });

  bot.callbackQuery(CB.status, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat) return;
    await send(ctx, await handleStatus(deps, ctx.chat.id));
  });

  bot.callbackQuery(CB.latestProgress, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat) return;
    await send(ctx, await handleLatestProgress(deps, ctx.chat.id));
  });

  bot.callbackQuery(CB.newSession, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewSessionRequest(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.newSessionCancel, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewSessionCancel(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.code, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleCodeRequest(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.newCode, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewCodeRequest(deps, ctx.chat.id, ctx.from.id));
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const profileId = parseProfileCallback(data);
    if (!profileId || !ctx.chat || !ctx.from) return;
    await ctx.answerCallbackQuery();
    await send(
      ctx,
      await handleProfilePicked(deps, ctx.chat.id, ctx.from.id, profileId)
    );
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!ctx.chat || !ctx.from) return;
    const flow = deps.flows.get(ctx.chat.id, ctx.from.id);
    if (text.startsWith("/") && flow.kind === "idle") return;

    if (flow.kind === "awaiting_instruction") {
      const codeReply = await runUserAction(ctx, async () =>
        handleInstructionSubmission(deps, ctx.chat.id, ctx.from.id, text)
      );
      if (codeReply) {
        await send(ctx, codeReply);
      }
      return;
    }

    const r = await handleApiKeySubmission(deps, ctx.chat.id, ctx.from.id, text);
    if (r) {
      await send(ctx, r);
    } else if (ctx.chat.type === "private") {
      await send(ctx, handlePlainText());
    }
  });

  bot.catch(async ({ error, ctx }) => {
    // eslint-disable-next-line no-console
    console.error("[bot] handler error:", error);
    try {
      const chatId = ctx.chat?.id;
      if (chatId) {
        await sendTelegramWithRetry(() =>
          ctx.api.sendMessage(chatId, formatUnexpectedError(error))
        );
      }
    } catch (sendErr) {
      // eslint-disable-next-line no-console
      console.error("[bot] failed to notify user of error:", sendErr);
    }
  });
}

async function runUserAction<T>(
  ctx: Context,
  action: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await action();
  } catch (e) {
    if (e instanceof ApiError && e.code === ERROR_CODES.RATE_LIMITED) {
      await send(ctx, { text: "⏱ Too fast — 1 instruction per second." });
      return;
    }
    throw e;
  }
}

async function send(ctx: Context, r: Reply): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  const replyMarkup = r.forceReply
    ? {
      force_reply: true as const,
      input_field_placeholder: r.inputFieldPlaceholder
    }
    : r.keyboard;
  await sendTelegramWithRetry(() =>
    ctx.api.sendMessage(chatId, r.text, {
      reply_markup: replyMarkup,
      parse_mode: r.parseMode
    })
  );
}

export function formatUnexpectedError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `❌ ${msg}`;
}
