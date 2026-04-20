import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createBot } from "../src/bot/bot.js";
import { FlowStore } from "../src/bot/flows.js";
import { makeHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;

beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.close();
});

describe("createBot factory", () => {
  it("constructs a grammY Bot and wires handlers", () => {
    const bot = createBot({
      telegramBotToken: "1:fake-token",
      sessions: h.sessions,
      messages: h.messages,
      flows: new FlowStore(),
      publicApiUrl: "https://example.com",
      now: h.now
    });
    expect(bot).toBeDefined();
    expect(typeof bot.handleUpdate).toBe("function");
  });
});
