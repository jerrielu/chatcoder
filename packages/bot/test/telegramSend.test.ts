import { describe, expect, it, vi } from "vitest";
import {
  processingMessageText,
  sendTelegramWithRetry,
  splitForTelegram
} from "../src/bot/telegramSend.js";

describe("splitForTelegram", () => {
  it("keeps short messages intact", () => {
    expect(splitForTelegram("hello")).toEqual(["hello"]);
  });
});

describe("processingMessageText", () => {
  it("includes only the first 100 words of the claimed message", () => {
    const words = Array.from({ length: 105 }, (_, i) => `w${i + 1}`);
    const text = processingMessageText(words.join(" "));
    expect(text).toContain(words.slice(0, 100).join(" "));
    expect(text).not.toContain("w101");
    expect(text.endsWith("...")).toBe(true);
  });
});

describe("sendTelegramWithRetry", () => {
  it("waits for Telegram retry_after and retries", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        error_code: 429,
        parameters: { retry_after: 11 },
        description: "Too Many Requests: retry after 11"
      })
      .mockResolvedValueOnce("ok");

    await expect(sendTelegramWithRetry(send, { sleep })).resolves.toBe("ok");

    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(11000);
  });

  it("also handles nested grammY error payloads", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        error: {
          error_code: 429,
          parameters: { retry_after: 2 }
        }
      })
      .mockResolvedValueOnce("ok");

    await expect(sendTelegramWithRetry(send, { sleep })).resolves.toBe("ok");

    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("rethrows after maxRetries", async () => {
    const err = {
      error_code: 429,
      parameters: { retry_after: 1 }
    };
    const sleep = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(err);

    await expect(
      sendTelegramWithRetry(send, { maxRetries: 1, sleep })
    ).rejects.toBe(err);

    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
