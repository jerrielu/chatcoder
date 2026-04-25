/**
 * Covers the defensive branches in bot.ts: callback_query without ctx.chat,
 * bot.catch (unexpected handler error), and slash-command filtering in
 * message:text for idle chats.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Bot, type ApiResponse } from "grammy";
import { wireBot } from "../src/bot/bot.js";
import { FlowStore } from "../src/bot/flows.js";
import { makeHarness, type TestHarness } from "./helpers.js";
import { CB } from "../src/bot/menus.js";

interface Outbound {
  method: string;
  payload: Record<string, unknown>;
}

function makeBot(deps: ReturnType<typeof buildDeps>, outbound: Outbound[]) {
  const bot = new Bot("1:fake", {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "test",
      username: "testbot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false
    }
  });
  bot.api.config.use(async (_prev, method, payload) => {
    outbound.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as ApiResponse<boolean>;
  });
  wireBot(bot, deps);
  return bot;
}

function buildDeps(h: TestHarness, flows: FlowStore) {
  return {
    apiKeys: h.apiKeys,
    profiles: h.profiles,
    sessions: h.sessions,
    messages: h.messages,
    flows,
    now: h.now
  };
}

let h: TestHarness;
let flows: FlowStore;
let out: Outbound[];
let bot: Bot;

beforeEach(async () => {
  h = await makeHarness();
  flows = new FlowStore();
  out = [];
  bot = makeBot(buildDeps(h, flows), out);
  await bot.init();
});
afterEach(async () => {
  await h.close();
});

describe("bot edge cases", () => {
  it("ignores callback_query without chat", async () => {
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: "cb",
        chat_instance: "ci",
        from: { id: 1, is_bot: false, first_name: "u" },
        data: CB.menu
      }
    });
    // No outbound sendMessage (no chat to reply into)
    const sends = out.filter((o) => o.method === "sendMessage");
    expect(sends).toEqual([]);
  });

  it("skips text messages without from/chat", async () => {
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private", first_name: "u" },
        text: "hi"
      }
    });
    expect(out).toEqual([]);
  });

  it("skips slash commands in message:text branch", async () => {
    // /help isn't registered; the message:text handler must return early on
    // leading-slash commands so it doesn't treat them as user-supplied keys.
    await bot.handleUpdate({
      update_id: 3,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 1, type: "private", first_name: "u" },
        from: { id: 1, is_bot: false, first_name: "u" },
        text: "/help"
      }
    });
    const sends = out.filter((o) => o.method === "sendMessage");
    expect(sends).toEqual([]);
  });

  it("formatUnexpectedError converts errors to chat-safe strings", async () => {
    const { formatUnexpectedError } = await import("../src/bot/bot.js");
    expect(formatUnexpectedError(new Error("x"))).toBe("❌ x");
    expect(formatUnexpectedError("plain string")).toBe("❌ plain string");
  });
});
