import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import { FlowStore } from "../src/bot/flows.js";
import {
  handleApiKeySubmission,
  handleNewSessionRequest,
  handleStatus
} from "../src/bot/handlers.js";

let h: TestHarness;
let flows: FlowStore;

function deps(overrides: Partial<Parameters<typeof handleStatus>[0]> = {}) {
  return {
    apiKeys: h.apiKeys,
    profiles: h.profiles,
    sessions: h.sessions,
    messages: h.messages,
    flows,
    now: h.now,
    ...overrides
  };
}

beforeEach(async () => {
  h = await makeHarness();
  flows = new FlowStore();
});
afterEach(async () => {
  await h.close();
});

describe("handler branch coverage", () => {
  it("handleStatus falls back to Date.now when deps.now is not provided", async () => {
    await h.seedSession({ chatId: 1, profileName: "main" });
    const r = await handleStatus(
      {
        apiKeys: h.apiKeys,
        profiles: h.profiles,
        sessions: h.sessions,
        messages: h.messages,
        flows
      },
      1
    );
    expect(r.text).toMatch(/main/);
  });

  it("handleStatus honors heartbeatStaleMs override", async () => {
    const seed = await h.seedSession({ chatId: 1, profileName: "main" });
    await h.apiKeys.updateHeartbeat(seed.apiKey.id);
    h.advanceTime(5_000);
    const online = await handleStatus(
      deps({ heartbeatStaleMs: 10_000 }),
      1
    );
    expect(online.text).toMatch(/online/);
    const offline = await handleStatus(
      deps({ heartbeatStaleMs: 1_000 }),
      1
    );
    expect(offline.text).toMatch(/offline/);
  });

  it("handleApiKeySubmission reports revoked key", async () => {
    const seed = await h.seedSession({ chatId: 99, profileName: "main" });
    await h.apiKeys.revoke(seed.apiKey.id);
    handleNewSessionRequest(deps(), 42, 7);
    const r = await handleApiKeySubmission(deps(), 42, 7, seed.rawApiKey);
    expect(r!.text).toMatch(/revoked/);
  });

  it("handleApiKeySubmission reports a daemon with no profiles", async () => {
    const seed = await h.seedSession({ chatId: 99, profileName: "main" });
    // Remove the profile via upsert — empty list.
    await h.profiles.upsertForApiKey(seed.apiKey.id, []);
    handleNewSessionRequest(deps(), 42, 7);
    const r = await handleApiKeySubmission(deps(), 42, 7, seed.rawApiKey);
    expect(r!.text).toMatch(/hasn't registered/);
  });
});
