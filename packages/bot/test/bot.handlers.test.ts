import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import { FlowStore } from "../src/bot/flows.js";
import {
  handleCode,
  handleGenerateKey,
  handleMenu,
  handleNewSessionCancel,
  handleNewSessionConfirm,
  handleNewSessionRequest,
  handlePlainText,
  handleResponse,
  handleStart,
  handleStatus,
  handleUserSuppliedKey,
  parseCodeCommand
} from "../src/bot/handlers.js";
import { ApiError, MAX_INSTRUCTION_BYTES, MAX_QUEUE_DEPTH } from "@chatcoder/shared";

let h: TestHarness;
let flows: FlowStore;

function deps(): Parameters<typeof handleCode>[0] {
  return {
    sessions: h.sessions,
    messages: h.messages,
    flows,
    publicApiUrl: "https://bot.example.com",
    now: h.now
  };
}

beforeEach(async () => {
  h = await makeHarness();
  flows = new FlowStore();
});
afterEach(async () => {
  await h.close();
});

describe("parseCodeCommand", () => {
  it("parses plain /code", () => {
    expect(parseCodeCommand("/code do a thing")).toBe("do a thing");
  });
  it("parses /code@botusername", () => {
    expect(parseCodeCommand("/code@mybot refactor foo")).toBe("refactor foo");
  });
  it("returns empty string when no args", () => {
    expect(parseCodeCommand("/code")).toBe("");
  });
  it("returns null for non-/code", () => {
    expect(parseCodeCommand("/help")).toBeNull();
    expect(parseCodeCommand("hello")).toBeNull();
  });
});

describe("simple replies", () => {
  it("handleStart returns welcome + menu", () => {
    const r = handleStart();
    expect(r.text).toContain("Chatcoder");
    expect(r.keyboard).toBeDefined();
  });
  it("handleMenu returns main menu", () => {
    expect(handleMenu().text).toMatch(/menu/i);
  });
  it("handlePlainText nudges toward /code", () => {
    expect(handlePlainText().text).toMatch(/\/code/);
  });
});

describe("handleStatus", () => {
  it("no-session path", async () => {
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/no active session/i);
  });
  it("offline when heartbeat stale", async () => {
    await h.sessions.rotate({ chatId: 1 });
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/offline/);
  });
  it("online after recent heartbeat", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    await h.sessions.updateHeartbeat(session.id);
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/online/);
  });
});

describe("handleResponse", () => {
  it("no-session path", async () => {
    const r = await handleResponse(deps(), 1);
    expect(r.text).toMatch(/no active session/i);
  });
  it("empty-queue path", async () => {
    await h.sessions.rotate({ chatId: 1 });
    const r = await handleResponse(deps(), 1);
    expect(r.text).toMatch(/no pending/i);
  });
  it("delivers oldest response and deletes it", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    await h.messages.enqueue({ sessionId: session.id, direction: "to_user", content: "hi!" });
    const r = await handleResponse(deps(), 1);
    expect(r.text).toContain("hi!");
    expect(await h.messages.count(session.id, "to_user")).toBe(0);
  });
  it("truncates very long responses", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    await h.messages.enqueue({
      sessionId: session.id,
      direction: "to_user",
      content: "y".repeat(5000)
    });
    const r = await handleResponse(deps(), 1);
    expect(r.text).toMatch(/\[truncated\]/);
  });
});

describe("new-session flow (two-step)", () => {
  it("initial request puts flow into confirming state", () => {
    const r = handleNewSessionRequest(deps(), 42, 100);
    expect(r.text).toMatch(/REVOKE/);
    expect(flows.get(42, 100).kind).toBe("confirming_rotation");
  });

  it("confirm advances to awaiting_rotation_key", () => {
    handleNewSessionRequest(deps(), 42, 100);
    const r = handleNewSessionConfirm(deps(), 42, 100);
    expect(r.text).toMatch(/Generate/);
    expect(flows.get(42, 100).kind).toBe("awaiting_rotation_key");
  });

  it("confirm without pending state tells user to start over", () => {
    const r = handleNewSessionConfirm(deps(), 99, 100);
    expect(r.text).toMatch(/expired/i);
  });

  it("cancel clears flow", () => {
    handleNewSessionRequest(deps(), 42, 100);
    handleNewSessionCancel(deps(), 42, 100);
    expect(flows.get(42, 100).kind).toBe("idle");
  });

  it("generate key rotates session and returns one-time key", async () => {
    handleNewSessionRequest(deps(), 42, 100);
    handleNewSessionConfirm(deps(), 42, 100);
    const r = await handleGenerateKey(deps(), 42, 100);
    expect(r.text).toMatch(/API KEY: cc_/);
    expect(flows.get(42, 100).kind).toBe("idle");
  });

  it("generate key without flow returns expired", async () => {
    const r = await handleGenerateKey(deps(), 42, 100);
    expect(r.text).toMatch(/expired/i);
  });

  it("user-supplied key accepted", async () => {
    handleNewSessionRequest(deps(), 42, 100);
    handleNewSessionConfirm(deps(), 42, 100);
    const r = await handleUserSuppliedKey(deps(), 42, 100, "my-very-own-key-12345");
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/Session created/);
  });

  it("user-supplied key rejected with feedback", async () => {
    handleNewSessionRequest(deps(), 42, 100);
    handleNewSessionConfirm(deps(), 42, 100);
    const r = await handleUserSuppliedKey(deps(), 42, 100, "short");
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/at least/);
  });

  it("user-supplied text ignored outside of rotation flow", async () => {
    const r = await handleUserSuppliedKey(deps(), 42, 100, "whatever");
    expect(r).toBeNull();
  });
});

describe("handleCode", () => {
  it("rejects empty instruction with usage hint", async () => {
    await h.sessions.rotate({ chatId: 1 });
    const r = await handleCode(deps(), 1, "");
    expect(r.text).toMatch(/Usage/);
  });

  it("rejects too-long instruction", async () => {
    await h.sessions.rotate({ chatId: 1 });
    const r = await handleCode(deps(), 1, "x".repeat(MAX_INSTRUCTION_BYTES + 1));
    expect(r.text).toMatch(/exceeds/);
  });

  it("no-session path", async () => {
    const r = await handleCode(deps(), 1, "do something");
    expect(r.text).toMatch(/No active session/);
  });

  it("accepts and queues", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    const r = await handleCode(deps(), 1, "lint");
    expect(r.text).toMatch(/Queued/);
    expect(await h.messages.count(session.id, "to_daemon")).toBe(1);
  });

  it("rate-limits second call within 1 s", async () => {
    await h.sessions.rotate({ chatId: 1 });
    await handleCode(deps(), 1, "first");
    await expect(handleCode(deps(), 1, "second")).rejects.toBeInstanceOf(ApiError);
  });

  it("queue-full rejects new enqueue", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      await h.messages.enqueue({
        sessionId: session.id,
        direction: "to_daemon",
        content: `pre-${i}`
      });
    }
    const r = await handleCode(deps(), 1, "overflow");
    expect(r.text).toMatch(/Queue full/);
  });
});

describe("FlowStore", () => {
  it("returns idle for unknown chat", () => {
    expect(flows.get(123, 456).kind).toBe("idle");
  });
  it("clear removes state", () => {
    flows.set(1, 2, { kind: "confirming_rotation" });
    flows.clear(1, 2);
    expect(flows.get(1, 2).kind).toBe("idle");
  });
  it("setting idle removes entry", () => {
    flows.set(1, 2, { kind: "confirming_rotation" });
    flows.set(1, 2, { kind: "idle" });
    expect(flows.get(1, 2).kind).toBe("idle");
  });
  it("isolates different users in same chat", () => {
    flows.set(1, 2, { kind: "confirming_rotation" });
    flows.set(1, 3, { kind: "awaiting_rotation_key" });
    expect(flows.get(1, 2).kind).toBe("confirming_rotation");
    expect(flows.get(1, 3).kind).toBe("awaiting_rotation_key");
  });
});
