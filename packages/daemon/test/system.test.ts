import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { buildServer } from "@chatcoder/bot/api/server";
import { openDb } from "@chatcoder/bot/db";
import { ApiKeysRepo } from "@chatcoder/bot/db/apiKeys";
import { ProfilesRepo } from "@chatcoder/bot/db/profiles";
import { SessionsRepo } from "@chatcoder/bot/db/sessions";
import { MessagesRepo } from "@chatcoder/bot/db/messages";
import { AdminRepo } from "@chatcoder/bot/db/admin";
import { ApiClient } from "../src/client.js";
import { Orchestrator } from "../src/orchestrator.js";
import { SessionManager } from "../src/sessionManager.js";
import { DaemonConfig } from "../src/config.js";
import { generateApiKey } from "../src/crypto.js";
import type { Profile } from "../src/profile.js";
import type { ToolExecutor } from "../src/toolExecutor.js";

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A fake ToolExecutor that echoes the instruction back with a profile prefix.
 * Lets us verify the full loop: bot DB → /v1/poll → correct ProfileRunner →
 * /v1/responses → TelegramSender is called with the expected chatId+text.
 */
class EchoTool {
  public calls: Array<{ profile: string; message: string }> = [];
  async execute(profile: Profile, message: string): Promise<string> {
    this.calls.push({ profile: profile.name, message });
    return JSON.stringify({ summary: `done with ${profile.name} instruction` });
  }
}

describe("system: bot ↔ daemon with profiles", () => {
  it("delivers an instruction to the right profile and response back to the right chat", async () => {
    const handle = await openDb("sqlite::memory:");
    const apiKeys = new ApiKeysRepo(handle.db);
    const profiles = new ProfilesRepo(handle.db);
    const sessions = new SessionsRepo(handle.db);
    const messages = new MessagesRepo(handle.db);
    const admin = new AdminRepo(handle.db);
    const sendResponse = vi.fn().mockResolvedValue(undefined);
    const app = await buildServer({
      apiKeysRepo: apiKeys,
      profilesRepo: profiles,
      sessionsRepo: sessions,
      messagesRepo: messages,
      adminRepo: admin,
      telegram: { sendResponse }
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${addr.port}`;

    // Daemon side: generate a key, register profiles with the bot.
    const { rawApiKey } = generateApiKey();
    const cfg = DaemonConfig.parse({
      apiUrl,
      apiKey: rawApiKey,
      pollIntervalMs: 100,
      pollJitterMs: 0,
      heartbeatIntervalMs: 100,
      profiles: [
        {
          tool: "CLAUDE_CODE",
          name: "alpha",
          claudeCode: { authToken: "sk-ant-x" }
        },
        {
          tool: "CLAUDE_CODE",
          name: "beta",
          claudeCode: { authToken: "sk-ant-y" }
        }
      ]
    });
    const client = new ApiClient({ apiUrl, apiKey: rawApiKey, retries: 0 });
    const register = await client.register({
      profiles: cfg.profiles.map((p) => ({ name: p.name, tool: p.tool }))
    });
    expect(register.profiles).toHaveLength(2);

    // Bot side: emulate the Telegram UX: user picks alpha for chat 101, beta for chat 202.
    const alphaProfileId = register.profiles.find((p) => p.name === "alpha")!.id;
    const betaProfileId = register.profiles.find((p) => p.name === "beta")!.id;
    const sessionA = await sessions.create({
      chatId: 101,
      apiKeyId: register.apiKeyId,
      profileId: alphaProfileId
    });
    const sessionB = await sessions.create({
      chatId: 202,
      apiKeyId: register.apiKeyId,
      profileId: betaProfileId
    });
    await messages.enqueue({ sessionId: sessionA.id, content: "hi-from-alpha" });
    await messages.enqueue({ sessionId: sessionB.id, content: "hi-from-beta" });

    const tool = new EchoTool();
    const sessionManager = new SessionManager({
      config: cfg,
      tool: tool as unknown as ToolExecutor,
      postResponse: (sessionId, content) =>
        client.postResponse({ sessionId, content }).then(() => undefined)
    });
    const orch = new Orchestrator({ config: cfg, client, sessionManager });
    orch.start();

    await waitFor(() => sendResponse.mock.calls.length >= 2, 5000);
    await sessionManager.drainAll();

    const byChat = new Map<number, string>();
    for (const [chatId, content] of sendResponse.mock.calls as Array<[number, string]>) {
      byChat.set(chatId, content);
    }
    expect(byChat.get(101)).toContain("done with alpha instruction");
    expect(byChat.get(202)).toContain("done with beta instruction");

    const fresh = await apiKeys.getById(register.apiKeyId);
    expect(fresh?.lastHeartbeat).not.toBeNull();

    await orch.stop();
    await app.close();
    await handle.close();
  }, 15_000);

  it("daemon stops when the api key is revoked", async () => {
    const handle = await openDb("sqlite::memory:");
    const apiKeys = new ApiKeysRepo(handle.db);
    const profiles = new ProfilesRepo(handle.db);
    const sessions = new SessionsRepo(handle.db);
    const messages = new MessagesRepo(handle.db);
    const admin = new AdminRepo(handle.db);
    const app = await buildServer({
      apiKeysRepo: apiKeys,
      profilesRepo: profiles,
      sessionsRepo: sessions,
      messagesRepo: messages,
      adminRepo: admin,
      telegram: { sendResponse: vi.fn().mockResolvedValue(undefined) }
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${addr.port}`;

    const { rawApiKey } = generateApiKey();
    const cfg = DaemonConfig.parse({
      apiUrl,
      apiKey: rawApiKey,
      pollIntervalMs: 100,
      pollJitterMs: 0,
      heartbeatIntervalMs: 100,
      profiles: [
        {
          tool: "CLAUDE_CODE",
          name: "solo",
          claudeCode: { authToken: "sk" }
        }
      ]
    });
    const client = new ApiClient({ apiUrl, apiKey: rawApiKey, retries: 0 });
    const reg = await client.register({
      profiles: cfg.profiles.map((p) => ({ name: p.name, tool: p.tool }))
    });

    const tool = new EchoTool();
    const sessionManager = new SessionManager({
      config: cfg,
      tool: tool as unknown as ToolExecutor,
      postResponse: async () => undefined
    });
    const orch = new Orchestrator({ config: cfg, client, sessionManager });
    orch.start();

    await waitFor(() => orch.status === "running", 2000);
    await apiKeys.revoke(reg.apiKeyId);
    await waitFor(() => orch.status === "session_revoked", 5000);

    await orch.stop();
    await app.close();
    await handle.close();
  }, 15_000);
});

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timed out");
}
