import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import { FlowStore } from "../src/bot/flows.js";
import {
  handleGenerateKey,
  handleNewSessionConfirm,
  handleNewSessionRequest,
  handleStatus,
  handleUserSuppliedKey
} from "../src/bot/handlers.js";

let h: TestHarness;
let flows: FlowStore;

beforeEach(async () => {
  h = await makeHarness();
  flows = new FlowStore();
});
afterEach(async () => {
  await h.close();
});

describe("handler branch coverage", () => {
  it("handleStatus falls back to Date.now when deps.now is not provided", async () => {
    await h.sessions.rotate({ chatId: 1 });
    const r = await handleStatus(
      {
        sessions: h.sessions,
        messages: h.messages,
        flows,
        publicApiUrl: undefined
      },
      1
    );
    // No deps.now supplied → branch at line 75 executes; the text renders.
    expect(r.text).toMatch(/Session/);
  });

  it("handleGenerateKey renders with publicApiUrl=undefined fallback", async () => {
    handleNewSessionRequest(
      { sessions: h.sessions, messages: h.messages, flows, publicApiUrl: undefined, now: h.now },
      77
    );
    handleNewSessionConfirm(
      { sessions: h.sessions, messages: h.messages, flows, publicApiUrl: undefined, now: h.now },
      77
    );
    const r = await handleGenerateKey(
      { sessions: h.sessions, messages: h.messages, flows, publicApiUrl: undefined, now: h.now },
      77,
      77
    );
    expect(r.text).toMatch(/your-bot-api/);
  });

  it("handleUserSuppliedKey handles non-Error throws gracefully", async () => {
    // Build a fake sessions repo whose rotate throws a string (not an Error).
    const fake: Pick<typeof h.sessions, "rotate"> = {
      rotate: async () => {
        throw "a raw string as an error"; // eslint-disable-line no-throw-literal
      }
    };
    const deps = {
      sessions: fake as unknown as typeof h.sessions,
      messages: h.messages,
      flows,
      publicApiUrl: undefined,
      now: h.now
    };
    handleNewSessionRequest(deps, 5);
    handleNewSessionConfirm(deps, 5);
    const r = await handleUserSuppliedKey(deps, 5, 5, "sufficiently-long-12345");
    expect(r).not.toBeNull();
    expect(r!.text).toMatch(/Invalid key/);
  });

  it("handleStatus honors heartbeatStaleMs override", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    await h.sessions.updateHeartbeat(session.id);
    h.advanceTime(5_000); // 5s since heartbeat
    // With staleMs=10s, still online.
    const online = await handleStatus(
      {
        sessions: h.sessions,
        messages: h.messages,
        flows,
        publicApiUrl: undefined,
        heartbeatStaleMs: 10_000,
        now: h.now
      },
      1
    );
    expect(online.text).toMatch(/online/);
    // With staleMs=1s, now offline.
    const offline = await handleStatus(
      {
        sessions: h.sessions,
        messages: h.messages,
        flows,
        publicApiUrl: undefined,
        heartbeatStaleMs: 1_000,
        now: h.now
      },
      1
    );
    expect(offline.text).toMatch(/offline/);
  });
});
