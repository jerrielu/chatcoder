import { Bot, type Context } from "grammy";
import { ApiError, ERROR_CODES } from "@chatcoder/shared";
import type { HandlerDeps, Reply } from "./handlers.js";
import {
  handleCode,
  handleGenerateKey,
  handleMenu,
  handleNewSessionCancel,
  handleNewSessionConfirm,
  handleNewSessionRequest,
  handlePlainText,
  handleResponse,
  handleStart,
  handleStatus,
  handleUserSuppliedKey,
  parseCodeCommand
} from "./handlers.js";
import { CB } from "./menus.js";

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

  bot.command("code", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const instruction = parseCodeCommand(text) ?? "";
    await runUserAction(ctx, async () => {
      if (!ctx.chat) return;
      const reply = await handleCode(deps, ctx.chat.id, instruction);
      await send(ctx, reply);
    });
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

  bot.callbackQuery(CB.response, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat) return;
    const replies = await handleResponse(deps, ctx.chat.id);
    for (const r of replies) {
      await send(ctx, r);
    }
  });

  bot.callbackQuery(CB.newSession, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewSessionRequest(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.newSessionConfirm, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewSessionConfirm(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.newSessionCancel, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, handleNewSessionCancel(deps, ctx.chat.id, ctx.from.id));
  });

  bot.callbackQuery(CB.generateKey, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.chat || !ctx.from) return;
    await send(ctx, await handleGenerateKey(deps, ctx.chat.id, ctx.from.id));
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // other commands handled above
    if (!ctx.chat || !ctx.from) return;

    const r = await handleUserSuppliedKey(deps, ctx.chat.id, ctx.from.id, text);
    if (r) {
      await send(ctx, r);
    } else if (ctx.chat.type === "private") {
      await send(ctx, handlePlainText());
    }
  });

  bot.catch(async ({ error, ctx }) => {
    ctx.api.sendMessage(ctx.chat?.id ?? 0, formatUnexpectedError(error)).catch(() => void 0);
  });
}

async function runUserAction(ctx: Context, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (e) {
    if (e instanceof ApiError && e.code === ERROR_CODES.RATE_LIMITED) {
      await send(ctx, { text: "⏱ Too fast — 1 /code per second." });
      return;
    }
    throw e;
  }
}

async function send(ctx: Context, r: Reply): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  await ctx.api.sendMessage(chatId, r.text, {
    reply_markup: r.keyboard,
    parse_mode: r.parseMode
  });
}

export function formatUnexpectedError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `❌ ${msg}`;
}
