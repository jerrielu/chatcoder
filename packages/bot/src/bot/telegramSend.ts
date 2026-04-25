import { ApiError } from "@chatcoder/shared";

/**
 * Splits a string into Telegram-safe chunks. Telegram's message cap is 4096
 * chars; we leave headroom for the Markdown code-fence wrapper used by the
 * sender.
 */
export function splitForTelegram(s: string): string[] {
  const LIMIT = 3800;
  const chunks: string[] = [];
  let current = s;
  while (current.length > 0) {
    if (current.length <= LIMIT) {
      chunks.push(current);
      break;
    }
    let splitAt = current.lastIndexOf("\n", LIMIT);
    if (splitAt < LIMIT * 0.8) splitAt = LIMIT;
    chunks.push(current.slice(0, splitAt));
    current = current.slice(splitAt).trimStart();
  }
  return chunks;
}

/**
 * Adapter the Fastify server uses to push daemon responses to a user's chat.
 * Concrete implementation wraps grammY's `bot.api.sendMessage`; tests inject
 * a spy.
 */
export interface TelegramSender {
  sendResponse(chatId: number, content: string): Promise<void>;
}

/**
 * Classifies an error thrown by the Telegram send path. Telegram 4xx errors
 * (bot blocked, chat not found, bad request) are permanent — we surface a
 * 400 so the daemon stops retrying. Everything else (network, Telegram 5xx)
 * propagates and Fastify returns 500, which the daemon's client retries.
 */
export function toApiErrorIfPermanent(e: unknown): ApiError | null {
  const err = e as { error_code?: number; description?: string } | undefined;
  const code = err?.error_code;
  if (typeof code === "number" && (code === 400 || code === 403)) {
    const desc = err?.description ?? "Telegram rejected the message";
    return ApiError.validation(`Telegram: ${desc}`);
  }
  return null;
}
