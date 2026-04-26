import { ApiError } from "@chatcoder/shared";
export interface TelegramRetryOptions {
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Splits a string into Telegram-safe chunks. Telegram's message cap is 4096
 * chars; we leave headroom for the Markdown code-fence wrapper used by the
 * sender.
 */
export declare function splitForTelegram(s: string): string[];
export declare function processingMessageText(content: string): string;
/**
 * Adapter the Fastify server uses to push daemon responses to a user's chat.
 * Concrete implementation wraps grammY's `bot.api.sendMessage`; tests inject
 * a spy.
 */
export interface TelegramSender {
    sendResponse(chatId: number, content: string): Promise<void>;
    sendProcessing?(chatId: number, content: string): Promise<void>;
    sendProcessed?(chatId: number): Promise<void>;
}
/**
 * Telegram returns 429 with `parameters.retry_after` when the bot sends too
 * quickly. Wait for the server-provided delay and retry the same API call.
 */
export declare function sendTelegramWithRetry<T>(send: () => Promise<T>, opts?: TelegramRetryOptions): Promise<T>;
/**
 * Classifies an error thrown by the Telegram send path. Telegram 4xx errors
 * (bot blocked, chat not found, bad request) are permanent — we surface a
 * 400 so the daemon stops retrying. Everything else (network, Telegram 5xx)
 * propagates and Fastify returns 500, which the daemon's client retries.
 */
export declare function toApiErrorIfPermanent(e: unknown): ApiError | null;
//# sourceMappingURL=telegramSend.d.ts.map