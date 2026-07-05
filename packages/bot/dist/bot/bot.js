import { Bot } from "grammy";
import { ApiError, ERROR_CODES } from "@chatcoder/shared";
import { handleApiKeySubmission, handleCodeRequest, handleFolderMenu, handleFolderPicked, handleInstructionSubmission, handleLatestProgress, handleMenu, handleNewCodeRequest, handleNewSessionCancel, handleNewSessionRequest, handlePlainText, handleProfileMenu, handleProfilePicked, handleStart, handleStatus, handleStop, handleVersion, handleWorkDirPicked } from "./handlers.js";
import { CB, mainMenu, parseFolderCallback, parseProfileCallback, parseWorkDirCallback } from "./menus.js";
import { sendTelegramWithRetry } from "./telegramSend.js";
import { transcribeAudio } from "./transcription.js";
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
    bot.callbackQuery(CB.menu, async (ctx) => {
        await ctx.answerCallbackQuery();
        await send(ctx, handleMenu());
    });
    bot.callbackQuery(CB.version, async (ctx) => {
        await ctx.answerCallbackQuery();
        await send(ctx, handleVersion());
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
    bot.callbackQuery(CB.stop, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat)
            return;
        await send(ctx, await handleStop(deps, ctx.chat.id));
    });
    bot.callbackQuery(CB.profileMenu, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, await handleProfileMenu(deps, ctx.chat.id, ctx.from.id));
    });
    bot.callbackQuery(CB.folderMenu, async (ctx) => {
        await ctx.answerCallbackQuery();
        if (!ctx.chat || !ctx.from)
            return;
        await send(ctx, await handleFolderMenu(deps, ctx.chat.id, ctx.from.id));
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
        const workDir = parseWorkDirCallback(data);
        if (workDir && ctx.chat && ctx.from) {
            await ctx.answerCallbackQuery();
            await send(ctx, await handleWorkDirPicked(deps, ctx.chat.id, ctx.from.id, workDir));
            return;
        }
        const folder = parseFolderCallback(data);
        if (folder && ctx.chat && ctx.from) {
            await ctx.answerCallbackQuery();
            await send(ctx, await handleFolderPicked(deps, ctx.chat.id, ctx.from.id, folder));
            return;
        }
        const profileId = parseProfileCallback(data);
        if (!profileId || !ctx.chat || !ctx.from)
            return;
        await ctx.answerCallbackQuery();
        await send(ctx, await handleProfilePicked(deps, ctx.chat.id, ctx.from.id, profileId));
    });
    // ── Voice / audio messages ───────────────────────────────────────
    bot.on("message:voice", async (ctx) => {
        if (!ctx.chat || !ctx.from)
            return;
        // 1. Acknowledge receipt
        await sendTelegramWithRetry(() => ctx.api.sendMessage(ctx.chat.id, "🎤 Transcribing voice message…", {
            reply_markup: mainMenu()
        }));
        try {
            // 2. Download the OGG Opus file from Telegram
            const file = await ctx.getFile();
            if (!file.file_path) {
                await ctx.api.sendMessage(ctx.chat.id, "❌ Could not retrieve voice file.");
                return;
            }
            const url = `https://api.telegram.org/file/bot${deps.telegramBotToken}/${file.file_path}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                await ctx.api.sendMessage(ctx.chat.id, "❌ Failed to download voice message.");
                return;
            }
            const audioBuffer = Buffer.from(await resp.arrayBuffer());
            // 3. Transcribe
            const text = await transcribeAudio(audioBuffer);
            if (!text) {
                await ctx.api.sendMessage(ctx.chat.id, "❌ Could not transcribe voice message. The audio may be too long or unclear.");
                return;
            }
            // 4. Show the user what was transcribed
            await ctx.api.sendMessage(ctx.chat.id, `📝 *Transcribed:* ${text}`, {
                parse_mode: "Markdown",
                reply_markup: mainMenu()
            });
            // 5. Feed into the instruction flow (same as a typed message)
            const flow = deps.flows.get(ctx.chat.id, ctx.from.id);
            if (flow.kind === "idle") {
                deps.flows.set(ctx.chat.id, ctx.from.id, {
                    kind: "awaiting_instruction",
                    resumeLastSession: true
                });
            }
            const codeReply = await handleInstructionSubmission(deps, ctx.chat.id, ctx.from.id, text);
            if (codeReply) {
                await send(ctx, codeReply);
            }
        }
        catch (err) {
            console.error("[bot] voice handler error:", err);
            await ctx.api.sendMessage(ctx.chat.id, "❌ Voice processing failed.").catch(() => { });
        }
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