import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import { FlowStore } from "../src/bot/flows.js";
import {
  handleApiKeySubmission,
  handleCodeRequest,
  handleInstructionSubmission,
  handleCode,
  handleMenu,
  handleNewCodeRequest,
  handleNewSessionCancel,
  handleNewSessionRequest,
  handlePlainText,
  handleProfilePicked,
  handleStart,
  handleStatus
} from "../src/bot/handlers.js";
import { ApiError, MAX_INSTRUCTION_BYTES, MAX_QUEUE_DEPTH } from "@chatcoder/shared";

let h: TestHarness;
let flows: FlowStore;

function deps(): Parameters<typeof handleCode>[0] {
  return {
    apiKeys: h.apiKeys,
    profiles: h.profiles,
    sessions: h.sessions,
    messages: h.messages,
    flows,
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

describe("simple replies", () => {
  it("handleStart returns welcome + menu", () => {
    const r = handleStart();
    expect(r.text).toContain("Chatcoder");
    expect(r.keyboard).toBeDefined();
  });
  it("handleMenu returns main menu", () => {
    expect(handleMenu().text).toMatch(/menu/i);
  });
  it("handlePlainText nudges toward menu actions", () => {
    expect(handlePlainText().text).toMatch(/Code/);
    expect(handlePlainText().text).toMatch(/New Code/);
  });
});

describe("instruction request flow", () => {
  it("code request opens force-reply and marks resume=true", () => {
    const r = handleCodeRequest(deps(), 42, 100);
    expect(r.forceReply).toBe(true);
    expect(r.text).toMatch(/resume/i);
    const state = flows.get(42, 100);
    expect(state.kind).toBe("awaiting_instruction");
    expect(state.kind === "awaiting_instruction" ? state.resumeLastSession : false).toBe(true);
  });

  it("new code request opens force-reply and marks resume=false", () => {
    const r = handleNewCodeRequest(deps(), 42, 100);
    expect(r.forceReply).toBe(true);
    expect(r.text).toMatch(/fresh/i);
    const state = flows.get(42, 100);
    expect(state.kind).toBe("awaiting_instruction");
    expect(state.kind === "awaiting_instruction" ? state.resumeLastSession : true).toBe(false);
  });

  it("instruction submission outside flow returns null", async () => {
    const r = await handleInstructionSubmission(deps(), 42, 100, "hi");
    expect(r).toBeNull();
  });
});

describe("handleStatus", () => {
  it("no-session path", async () => {
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/no active session/i);
  });
  it("offline when heartbeat stale", async () => {
    await h.seedSession({ chatId: 1 });
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/offline/);
  });
  it("online after recent heartbeat", async () => {
    const { apiKey } = await h.seedSession({ chatId: 1 });
    await h.apiKeys.updateHeartbeat(apiKey.id);
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/online/);
  });
  it("lists profile name in the status line", async () => {
    await h.seedSession({ chatId: 1, profileName: "myprof", tool: "OPENAI" });
    const r = await handleStatus(deps(), 1);
    expect(r.text).toMatch(/myprof/);
  });
});

describe("new-session flow (api-key → profile picker)", () => {
  it("initial request puts flow into awaiting_api_key", () => {
    const r = handleNewSessionRequest(deps(), 42, 100);
    expect(r.text).toMatch(/Paste the API key/i);
    expect(flows.get(42, 100).kind).toBe("awaiting_api_key");
    expect(r.forceReply).toBe(true);
  });

  it("cancel clears flow", () => {
    handleNewSessionRequest(deps(), 42, 100);
    handleNewSessionCancel(deps(), 42, 100);
    expect(flows.get(42, 100).kind).toBe("idle");
  });

  it("submit api key validates length", async () => {
    handleNewSessionRequest(deps(), 42, 100);
    const r = await handleApiKeySubmission(deps(), 42, 100, "short");
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/at least/);
  });

  it("submit unknown api key surfaces error and keeps flow", async () => {
    handleNewSessionRequest(deps(), 42, 100);
    const r = await handleApiKeySubmission(deps(), 42, 100, "not-a-known-key-abcdef");
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/don't know/i);
    expect(r!.forceReply).toBe(true);
    expect(flows.get(42, 100).kind).toBe("awaiting_api_key");
  });

  it("submit known api key advances to awaiting_profile with picker", async () => {
    const seed = await h.seedSession({ chatId: 999, profileName: "main" });
    handleNewSessionRequest(deps(), 42, 100);
    const r = await handleApiKeySubmission(deps(), 42, 100, seed.rawApiKey);
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/Pick a profile/);
    const state = flows.get(42, 100);
    expect(state.kind).toBe("awaiting_profile");
    expect(state.kind === "awaiting_profile" ? state.apiKeyId : "").toBe(seed.apiKey.id);
  });

  it("submit known api key outside flow still advances to awaiting_profile", async () => {
    const seed = await h.seedSession({ chatId: 999, profileName: "main" });
    const r = await handleApiKeySubmission(deps(), 42, 100, seed.rawApiKey);
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/Pick a profile/);
    const state = flows.get(42, 100);
    expect(state.kind).toBe("awaiting_profile");
    expect(state.kind === "awaiting_profile" ? state.apiKeyId : "").toBe(seed.apiKey.id);
  });

  it("submit key with leading slash while awaiting api-key is accepted", async () => {
    const seed = await h.seedSession({ chatId: 999, profileName: "main" });
    handleNewSessionRequest(deps(), 42, 100);
    const r = await handleApiKeySubmission(deps(), 42, 100, `/${seed.rawApiKey}`);
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/Pick a profile/);
  });

  it("submit text outside awaiting_api_key returns null (plain-text fallback)", async () => {
    const r = await handleApiKeySubmission(deps(), 42, 100, "anything");
    expect(r).toBeNull();
  });

  it("profile pick creates a session for the chat", async () => {
    const seed = await h.seedSession({ chatId: 999, profileName: "main" });
    handleNewSessionRequest(deps(), 42, 100);
    await handleApiKeySubmission(deps(), 42, 100, seed.rawApiKey);
    const r = await handleProfilePicked(deps(), 42, 100, seed.profile.id);
    expect(r.text).toMatch(/Session linked/i);
    expect(flows.get(42, 100).kind).toBe("idle");
    const active = await h.sessions.listActiveByChatId(42);
    expect(active).toHaveLength(1);
    expect(active[0]!.profileId).toBe(seed.profile.id);
  });

  it("profile pick outside flow tells user to start over", async () => {
    const r = await handleProfilePicked(deps(), 42, 100, "missing-id");
    expect(r.text).toMatch(/expired/i);
  });

  it("profile pick with foreign profileId is rejected", async () => {
    const seedA = await h.seedSession({ chatId: 999, profileName: "a" });
    const seedB = await h.seedSession({ chatId: 888, profileName: "b" });
    handleNewSessionRequest(deps(), 42, 100);
    await handleApiKeySubmission(deps(), 42, 100, seedA.rawApiKey);
    const r = await handleProfilePicked(deps(), 42, 100, seedB.profile.id);
    expect(r.text).toMatch(/Unknown profile/i);
  });
});

describe("handleCode", () => {
  it("rejects empty instruction", async () => {
    await h.seedSession({ chatId: 1 });
    const r = await handleCode(deps(), 1, "");
    expect(r.text).toMatch(/empty/i);
  });

  it("rejects too-long instruction", async () => {
    await h.seedSession({ chatId: 1 });
    const r = await handleCode(deps(), 1, "x".repeat(MAX_INSTRUCTION_BYTES + 1));
    expect(r.text).toMatch(/exceeds/);
  });

  it("no-session path", async () => {
    const r = await handleCode(deps(), 1, "do something");
    expect(r.text).toMatch(/No active session/);
  });

  it("accepts and queues into the most recent session", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    const r = await handleCode(deps(), 1, "lint");
    expect(r.text).toMatch(/Queued/);
    expect(await h.messages.count(seed.session.id)).toBe(1);
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.resumeLastSession).toBe(true);
  });

  it("queues with resumeLastSession=false when requested", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    const r = await handleCode(deps(), 1, "lint", false);
    expect(r.text).toMatch(/fresh/);
    const [msg] = await h.messages.drain(seed.session.id);
    expect(msg?.resumeLastSession).toBe(false);
  });

  it("rate-limits second call within 1 s", async () => {
    await h.seedSession({ chatId: 1 });
    await handleCode(deps(), 1, "first");
    await expect(handleCode(deps(), 1, "second")).rejects.toBeInstanceOf(ApiError);
  });

  it("queue-full rejects new enqueue", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      await h.messages.enqueue({ sessionId: seed.session.id, content: `pre-${i}` });
    }
    const r = await handleCode(deps(), 1, "overflow");
    expect(r.text).toMatch(/Queue full/);
  });

  it("targets the most recently created session when the chat has multiple", async () => {
    const seedA = await h.seedSession({ chatId: 1, profileName: "a" });
    h.advanceTime(10_000);
    const seedB = await h.seedSession({ chatId: 1, profileName: "b" });
    h.advanceTime(2_000);
    await handleCode(deps(), 1, "hello");
    expect(await h.messages.count(seedB.session.id)).toBe(1);
    expect(await h.messages.count(seedA.session.id)).toBe(0);
  });

  it("instruction submission consumes awaiting_instruction flow", async () => {
    await h.seedSession({ chatId: 1 });
    handleCodeRequest(deps(), 1, 2);
    const r = await handleInstructionSubmission(deps(), 1, 2, "hello");
    expect(r?.text).toMatch(/Queued/);
    expect(flows.get(1, 2).kind).toBe("idle");
  });

  it("instruction submission keeps flow on empty input", async () => {
    await h.seedSession({ chatId: 1 });
    handleCodeRequest(deps(), 1, 2);
    const r = await handleInstructionSubmission(deps(), 1, 2, "   ");
    expect(r?.text).toMatch(/empty/i);
    expect(flows.get(1, 2).kind).toBe("awaiting_instruction");
  });
});

describe("FlowStore", () => {
  it("returns idle for unknown chat", () => {
    expect(flows.get(123, 456).kind).toBe("idle");
  });
  it("clear removes state", () => {
    flows.set(1, 2, { kind: "awaiting_api_key" });
    flows.clear(1, 2);
    expect(flows.get(1, 2).kind).toBe("idle");
  });
  it("setting idle removes entry", () => {
    flows.set(1, 2, { kind: "awaiting_api_key" });
    flows.set(1, 2, { kind: "idle" });
    expect(flows.get(1, 2).kind).toBe("idle");
  });
  it("isolates different users in same chat", () => {
    flows.set(1, 2, { kind: "awaiting_api_key" });
    flows.set(1, 3, { kind: "awaiting_profile", apiKeyId: "a1" });
    expect(flows.get(1, 2).kind).toBe("awaiting_api_key");
    expect(flows.get(1, 3).kind).toBe("awaiting_profile");
  });
});
