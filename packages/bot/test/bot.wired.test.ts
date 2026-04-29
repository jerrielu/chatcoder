/**
 * Test the grammY wiring end-to-end by feeding fabricated Telegram updates
 * through bot.handleUpdate and capturing the outbound API calls.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Bot, type ApiResponse } from "grammy";
import { CODEX_TOKEN_USAGE_COMMAND } from "@chatcoder/shared";
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

function msgUpdate(
  chatId: number,
  userId: number,
  text: string,
  updateId = 1,
  replyToText?: string
): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: "private", first_name: "u" },
      from: { id: userId, is_bot: false, first_name: "u" },
      text,
      reply_to_message: replyToText
        ? {
            message_id: updateId - 1,
            date: 0,
            chat: { id: chatId, type: "private", first_name: "u" },
            from: { id: 1, is_bot: true, first_name: "bot" },
            text: replyToText
          }
        : undefined,
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

describe("wireBot /token", () => {
  it("queues a Codex token-usage request", async () => {
    const seed = await h.seedSession({ chatId: 1, tool: "OPENAI" });
    await bot.handleUpdate(msgUpdate(1, 1, "/token"));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Token usage request queued/);
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.content).toBe(CODEX_TOKEN_USAGE_COMMAND);
  });
});

describe("wireBot instruction menu flow", () => {
  it("Code callback opens input and queues a resume instruction", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    await bot.handleUpdate(cbUpdate(1, 1, CB.code, 1));
    await bot.handleUpdate(msgUpdate(1, 1, "run tests", 2));
    const sent = sends();
    const texts = sent.map((m) => (m.payload as { text: string }).text);
    expect(texts.some((t) => t.includes("resume"))).toBe(true);
    expect(texts.some((t) => t.includes("Queued"))).toBe(true);
    const queued = sent.find((m) =>
      (m.payload as { text: string }).text.includes("Queued")
    )!;
    expect((queued.payload as { reply_markup: unknown }).reply_markup).toBeDefined();
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.resumeLastSession).toBe(true);
  });

  it("New Code callback opens input and queues a fresh instruction", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    await bot.handleUpdate(cbUpdate(1, 1, CB.newCode, 1));
    await bot.handleUpdate(msgUpdate(1, 1, "run tests", 2));
    const texts = sends().map((m) => (m.payload as { text: string }).text);
    expect(texts.some((t) => t.includes("fresh"))).toBe(true);
    expect(texts.some((t) => t.includes("Queued"))).toBe(true);
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.resumeLastSession).toBe(false);
  });

  it("rate-limits second instruction within 1s", async () => {
    await h.seedSession({ chatId: 1 });
    await bot.handleUpdate(cbUpdate(1, 1, CB.code, 1));
    await bot.handleUpdate(msgUpdate(1, 1, "first", 2));
    await bot.handleUpdate(cbUpdate(1, 1, CB.code, 3));
    await bot.handleUpdate(msgUpdate(1, 1, "second", 4));
    const texts = sends().map((m) => (m.payload as { text: string }).text);
    expect(texts.some((t) => t.includes("Too fast"))).toBe(true);
  });

  it("recovers a resume instruction reply when flow state was lost", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    await bot.handleUpdate(
      msgUpdate(1, 1, "run tests", 2, "💻 Code (resume)\n\nEnter the instruction")
    );
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Queued/);
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.content).toBe("run tests");
    expect(msg?.resumeLastSession).toBe(true);
  });

  it("recovers a fresh instruction reply when flow state was lost", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    await bot.handleUpdate(
      msgUpdate(1, 1, "run tests", 2, "🆕 New Code (fresh)\n\nEnter the instruction")
    );
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Queued/);
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.content).toBe("run tests");
    expect(msg?.resumeLastSession).toBe(false);
  });
});

describe("wireBot callback flow", () => {
  it("new session → paste key → pick profile → session linked", async () => {
    const seed = await h.seedSession({ chatId: 99, profileName: "main" });

    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(msgUpdate(1, 1, seed.rawApiKey, 2));
    await bot.handleUpdate(cbUpdate(1, 1, CB.profilePrefix + seed.profile.id, 3));

    const texts = sends().map((m) => (m.payload as { text: string }).text);
    expect(texts.join("\n")).toMatch(/Session linked/);
    const active = await h.sessions.getLatestActiveByChatId(1);
    expect(active).not.toBeNull();
    expect(active!.profileId).toBe(seed.profile.id);
  });

  it("cancel clears flow", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSessionCancel, 2));
    expect(flows.get(1, 1).kind).toBe("idle");
  });

  it("new session prompt opens an API-key input", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    const last = sends().at(-1)!;
    const markup = (last.payload as { reply_markup?: Record<string, unknown> }).reply_markup;
    expect(markup).toBeDefined();
    expect(markup?.["force_reply"]).toBe(true);
    expect(markup?.["input_field_placeholder"]).toBe("Paste coder API key");
  });

  it("status shows session info", async () => {
    await h.seedSession({ chatId: 1, profileName: "main" });
    await bot.handleUpdate(cbUpdate(1, 1, CB.status, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/main/);
  });

  it("menu callback shows main menu", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.menu, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/menu/i);
  });

  it("Codex effort menu blocks non-OPENAI profiles", async () => {
    await h.seedSession({ chatId: 1, tool: "CLAUDE_CODE" });
    await bot.handleUpdate(cbUpdate(1, 1, CB.codexEffortMenu, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/only available for Codex profiles/i);
  });

  it("Codex effort selection persists and applies to queued OPENAI instructions", async () => {
    const seed = await h.seedSession({ chatId: 1, tool: "OPENAI", profileName: "codex" });
    await bot.handleUpdate(cbUpdate(1, 1, CB.codexEffortMenu, 1));
    await bot.handleUpdate(cbUpdate(1, 1, CB.codexEffortPrefix + "xhigh", 2));
    await bot.handleUpdate(cbUpdate(1, 1, CB.code, 3));
    await bot.handleUpdate(msgUpdate(1, 1, "run tests", 4));
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.codexReasoningEffort).toBe("xhigh");
  });

  it("code callback prompt opens a force-reply input", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.code, 1));
    const last = sends().at(-1)!;
    const markup = (last.payload as { reply_markup?: Record<string, unknown> }).reply_markup;
    expect(markup).toBeDefined();
    expect(markup?.["force_reply"]).toBe(true);
    expect(markup?.["selective"]).toBeUndefined();
  });

  it("new code callback prompt opens a force-reply input", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newCode, 1));
    const last = sends().at(-1)!;
    const markup = (last.payload as { reply_markup?: Record<string, unknown> }).reply_markup;
    expect(markup).toBeDefined();
    expect(markup?.["force_reply"]).toBe(true);
    expect(markup?.["selective"]).toBeUndefined();
  });
});

describe("wireBot plain text", () => {
  it("nudges toward Code/New Code outside of any flow", async () => {
    await bot.handleUpdate(msgUpdate(1, 1, "random words"));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/New Code/);
  });

  it("accepts key paste outside of an explicit new-session flow", async () => {
    const seed = await h.seedSession({ chatId: 99, profileName: "main" });
    await bot.handleUpdate(msgUpdate(1, 1, seed.rawApiKey, 1));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Pick a profile/);
  });

  it("treats text as the API key when awaiting one and advances to profile picker", async () => {
    const seed = await h.seedSession({ chatId: 99, profileName: "main" });
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(msgUpdate(1, 1, seed.rawApiKey, 2));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Pick a profile/);
  });

  it("accepts '/cc_...' text while awaiting an api key", async () => {
    const seed = await h.seedSession({ chatId: 99, profileName: "main" });
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(msgUpdate(1, 1, `/${seed.rawApiKey}`, 2));
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Pick a profile/);
  });

  it("supports /cancel command to exit api-key flow", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.newSession, 1));
    await bot.handleUpdate(msgUpdate(1, 1, "/cancel", 2));
    expect(flows.get(1, 1).kind).toBe("idle");
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Cancelled/i);
  });

  it("supports /cancel command to exit code-input flow", async () => {
    await bot.handleUpdate(cbUpdate(1, 1, CB.code, 1));
    await bot.handleUpdate(msgUpdate(1, 1, "/cancel", 2));
    expect(flows.get(1, 1).kind).toBe("idle");
    const last = sends().at(-1)!;
    expect((last.payload as { text: string }).text).toMatch(/Cancelled/i);
  });
});
