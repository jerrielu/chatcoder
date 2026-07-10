import { ApiError } from "@chatcoder/shared";
const DEFAULT_MAX_RETRIES = 3;
/**
 * Splits a string into Telegram-safe chunks. Telegram's message cap is 4096
 * chars; we leave headroom for the Markdown code-fence wrapper used by the
 * sender.
 */
export function splitForTelegram(s) {
    const LIMIT = 3800;
    const chunks = [];
    let current = s;
    while (current.length > 0) {
        if (current.length <= LIMIT) {
            chunks.push(current);
            break;
        }
        let splitAt = current.lastIndexOf("\n", LIMIT);
        if (splitAt < LIMIT * 0.8)
            splitAt = LIMIT;
        chunks.push(current.slice(0, splitAt));
        current = current.slice(splitAt).trimStart();
    }
    return chunks;
}
/**
 * Escape special characters for Telegram MarkdownV2.
 * Characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(text) {
    return text.replace(/[_*[\]()~`>#+\-=\|{}.!]/g, "\\$&");
}
/**
 * Strip Telegram MarkdownV2 escape backslashes to produce clean Markdown.
 * Reverses the escaping done by escapeMarkdownV2 and by telegram-markdown-v2's
 * convert() — removes the backslash before each escaped character.
 */
export function stripMarkdownV2(text) {
    return text.replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, "$1");
}
export function processingMessageText(content) {
    const words = content.trim().split(/\s+/).filter(Boolean);
    const preview = words.slice(0, 100).join(" ");
    const suffix = words.length > 100 ? "..." : "";
    return `🔄 Daemon is processing your message:\n\n${preview}${suffix}`;
}
/**
 * Telegram returns 429 with `parameters.retry_after` when the bot sends too
 * quickly. Wait for the server-provided delay and retry the same API call.
 */
export async function sendTelegramWithRetry(send, opts = {}) {
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const sleep = opts.sleep ?? sleepMs;
    for (let attempt = 0;; attempt += 1) {
        try {
            return await send();
        }
        catch (e) {
            const retryAfter = telegramRetryAfterSeconds(e);
            if (retryAfter === null || attempt >= maxRetries) {
                throw e;
            }
            await sleep(retryAfter * 1000);
        }
    }
}
/**
 * Classifies an error thrown by the Telegram send path. Telegram 4xx errors
 * (bot blocked, chat not found, bad request) are permanent — we surface a
 * 400 so the daemon stops retrying. Everything else (network, Telegram 5xx)
 * propagates and Fastify returns 500, which the daemon's client retries.
 */
export function toApiErrorIfPermanent(e) {
    const err = e;
    const code = err?.error_code;
    if (typeof code === "number" && (code === 400 || code === 403)) {
        const desc = err?.description ?? "Telegram rejected the message";
        return ApiError.validation(`Telegram: ${desc}`);
    }
    return null;
}
function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function telegramRetryAfterSeconds(e) {
    const err = e;
    const code = err?.error_code ?? err?.error?.error_code;
    if (code !== 429)
        return null;
    const retryAfter = err?.parameters?.retry_after ?? err?.error?.parameters?.retry_after;
    if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter)) {
        return 1;
    }
    return Math.max(1, Math.ceil(retryAfter));
}
//# sourceMappingURL=telegramSend.js.map