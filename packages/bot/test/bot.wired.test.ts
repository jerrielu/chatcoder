/**
 * Test the grammY wiring end-to-end by feeding fabricated Telegram updates
 * through bot.handleUpdate and capturing the outbound API calls.
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

function makeBot(deps: ReturnType<typeof buildDeps>, outbound: Outbound[]): Bot {
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
    // Minimal "ok" response; we don't inspect specifics beyond the call record.
    return { ok: true, result: true } as ApiResponse<boolean>;
  });
  wireBot(bot, deps);
  return bot;
}

function buildDeps(h: TestHarness, flows: FlowStore) {
  return {
    sessions: h.sessions,
    messages: h.messages,
    flows,
    publicApiUrl: "https://bot.example.com",
    now: h.now
  };
}

function msgUpdate(chatId: number, userId: number, text: string, updateId = 1): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "u" },
      from: { id: userId, is_bot: false, first_name: "u" },
      text,
      entities:
        text.startsWith("/") && !text.startsWith("/ ")
          ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }]
          : undefined
    }
  };
}

function cbUpdate(chatId: number, userId: number, data: string, updateId = 1): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb${updateId}`,
      chat_instance: "ci",
      from: { id: userId, is_bot: false, first_name: "u" },
      data,
      message: {
        message_id: 9,
        date: 0,
        chat: { id: chatId, type: "private", first_name: "u" },
        from: { id: 1, is_bot: true, first_name: "bot" },
        text: "..."
      }
    }
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

function sends(): Outbound[] {
  return out.filter((o) => o.method === "sendMessage");
}

describe("wireBot /start", () => {
  it("sends welcome with main menu", async () => {
    await bot.handleUpdate(msgUpdate(1, 1, "/start"));
    const m = sends().at(-1)!;
    expect((m.payload as { text: string }).text).toMatch(/Chatcoder/);
    expect((m.payload as { reply_markup: unknown }).reply_markup).toBeDefined();
  });
});

describe("wireBot /code", () => {
  it("rate-limits second call within 1s with 'Too fast'", async () => {
    await h.sessions.rotate({ chatId: 1 });
    await bot.handleUpdate(msgUpdate(1, 1, "/code first", 1));
    await bot.handleUpdate(msgUpdate(1, 1, "/code second", 2));
    const texts = sends().map((m) => (m.payload as { text: string }).text);
    expect(texts.some((t) => t.includes("Too fast"))).toBe(true);
  });

  it("queues when under rate", async () => {
    await h.sessions.rotate({ chatId: 1 });
    await bot.handleUpdate(msgUpdate(1, 1, "/code run tests"));
    const texts = sends().map((m) => (m.payload as { text: string }).text);
    expect(texts.some((t) => t.includes("Queued"))).toBe(true);
  });
});

describe("wireBot callback flow", () => {
  it("new session → confirm → generate → new session visible", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSessionConfirm, 2));
    await bot.handleUpdate(cbUpdate(1, 1, CB.generateKey, 3));
    const texts = sends().map((m) => (m.payload as { text: string }).text);
    expect(texts.join("\n")).toMatch(/Session created/);
    const active = await h.sessions.getActiveByChatId(1);
    expect(active).not.toBeNull();
  });

  it("cancel clears flow", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSessionCancel, 2));
    expect(flows.get(1).kind).toBe("idle");
  });

  it("status shows session info", async () => {
    await h.sessions.rotate({ chatId: 1 });
    await bot.handleUpdate(cbUpdate(1, 1, CB.status, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Session/);
  });

  it("response callback delivers pending response", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    await h.messages.enqueue({ sessionId: session.id, direction: "to_user", content: "yay" });
    await bot.handleUpdate(cbUpdate(1, 1, CB.response, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toContain("yay");
  });

  it("menu callback shows main menu", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.menu, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/menu/i);
  });
});

describe("wireBot plain text", () => {
  it("nudges toward /code outside of any flow", async () => {
    await bot.handleUpdate(msgUpdate(1, 1, "random words"));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/\/code/);
  });

  it("treats text as the user-supplied key when awaiting one", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSessionConfirm, 2));
    await bot.handleUpdate(msgUpdate(1, 1, "mysupersecretkey-xxxxxxxxxxxx"));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Session created/);
  });
});
