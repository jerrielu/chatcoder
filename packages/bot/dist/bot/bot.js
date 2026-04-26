import { Bot } from "grammy";
import { ApiError, ERROR_CODES } from "@chatcoder/shared";
import { handleApiKeySubmission, handleCodeRequest, handleInstructionSubmission, handleLatestProgress, handleMenu, handleNewCodeRequest, handleNewSessionCancel, handleNewSessionRequest, handlePlainText, handleProfilePicked, handleStart, handleStatus, handleTokenUsage } from "./handlers.js";
import { CB, mainMenu, parseProfileCallback } from "./menus.js";
import { sendTelegramWithRetry } from "./telegramSend.js";
export function createBot(opts) {
    const bot = new Bot(opts.telegramBotToken);
    wireBot(bot, opts);
    return bot;
}
/** Exported so tests can wire a mock Bot. */
export function wireBot(bot, deps) {
    bot.command("start", async (ctx) => {
        await send(ctx, handleStart());
    });
    bot.command("cancel", async (ctx) => {
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, handleNewSessionCancel(deps, ctx.chat.id, ctx.from.id));
    });
    bot.command("token", async (ctx) => {
        if (!ctx.chat)
            return;
        await send(ctx, await handleTokenUsage(deps, ctx.chat.id));
    });
    bot.callbackQuery(CB.menu, async (ctx) => {
        await ctx.answerCallbackQuery();
        await send(ctx, handleMenu());
    });
    bot.callbackQuery(CB.status, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat)
            return;
        await send(ctx, await handleStatus(deps, ctx.chat.id));
    });
    bot.callbackQuery(CB.latestProgress, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat)
            return;
        await send(ctx, await handleLatestProgress(deps, ctx.chat.id));
    });
    bot.callbackQuery(CB.tokenUsage, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat)
            return;
        await send(ctx, await handleTokenUsage(deps, ctx.chat.id));
    });
    bot.callbackQuery(CB.newSession, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, handleNewSessionRequest(deps, ctx.chat.id, ctx.from.id));
    });
    bot.callbackQuery(CB.newSessionCancel, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, handleNewSessionCancel(deps, ctx.chat.id, ctx.from.id));
    });
    bot.callbackQuery(CB.code, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, handleCodeRequest(deps, ctx.chat.id, ctx.from.id));
    });
    bot.callbackQuery(CB.newCode, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, handleNewCodeRequest(deps, ctx.chat.id, ctx.from.id));
    });
    bot.on("callback_query:data", async (ctx) => {
        const data = ctx.callbackQuery.data;
        const profileId = parseProfileCallback(data);
        if (!profileId || !ctx.chat || !ctx.from)
            return;
        await ctx.answerCallbackQuery();
        await send(ctx, await handleProfilePicked(deps, ctx.chat.id, ctx.from.id, profileId));
    });
    bot.on("message:text", async (ctx) => {
        const text = ctx.message.text;
        if (!ctx.chat || !ctx.from)
            return;
        const flow = deps.flows.get(ctx.chat.id, ctx.from.id);
        if (text.startsWith("/") && flow.kind === "idle")
            return;
        if (flow.kind === "idle") {
            const recoveredResume = recoverInstructionMode(ctx);
            if (recoveredResume !== null) {
                deps.flows.set(ctx.chat.id, ctx.from.id, {
                    kind: "awaiting_instruction",
                    resumeLastSession: recoveredResume
                });
            }
        }
        if (deps.flows.get(ctx.chat.id, ctx.from.id).kind === "awaiting_instruction") {
            const codeReply = await runUserAction(ctx, async () => handleInstructionSubmission(deps, ctx.chat.id, ctx.from.id, text));
            if (codeReply) {
                await send(ctx, codeReply);
            }
            return;
        }
        const r = await handleApiKeySubmission(deps, ctx.chat.id, ctx.from.id, text);
        if (r) {
            await send(ctx, r);
        }
        else if (ctx.chat.type === "private") {
            await send(ctx, handlePlainText());
        }
    });
    bot.catch(async ({ error, ctx }) => {
        // eslint-disable-next-line no-console
        console.error("[bot] handler error:", error);
        try {
            const chatId = ctx.chat?.id;
            if (chatId) {
                await sendTelegramWithRetry(() => ctx.api.sendMessage(chatId, formatUnexpectedError(error), {
                    reply_markup: mainMenu()
                }));
            }
        }
        catch (sendErr) {
            // eslint-disable-next-line no-console
            console.error("[bot] failed to notify user of error:", sendErr);
        }
    });
}
function recoverInstructionMode(ctx) {
    const prompt = ctx.message?.reply_to_message;
    if (!prompt?.from?.is_bot || !("text" in prompt) || typeof prompt.text !== "string") {
        return null;
    }
    if (prompt.text.includes("Code (resume)"))
        return true;
    if (prompt.text.includes("New Code (fresh)"))
        return false;
    return null;
}
async function runUserAction(ctx, action) {
    try {
        return await action();
    }
    catch (e) {
        if (e instanceof ApiError && e.code === ERROR_CODES.RATE_LIMITED) {
            await send(ctx, { text: "⏱ Too fast — 1 instruction per second." });
            return;
        }
        throw e;
    }
}
async function send(ctx, r) {
    const chatId = ctx.chat?.id;
    if (!chatId)
        return;
    const replyMarkup = r.forceReply
        ? {
            force_reply: true,
            input_field_placeholder: r.inputPlaceholder ?? "Describe the code change"
        }
        : r.keyboard ?? mainMenu();
    await sendTelegramWithRetry(() => ctx.api.sendMessage(chatId, r.text, {
        reply_markup: replyMarkup,
        parse_mode: r.parseMode
    }));
}
export function formatUnexpectedError(e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `❌ ${msg}`;
}
//# sourceMappingURL=bot.js.map