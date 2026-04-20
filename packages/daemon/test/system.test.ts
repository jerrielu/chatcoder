import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { buildServer } from "@chatcoder/bot/api/server";
import { openDb } from "@chatcoder/bot/db";
import { SessionsRepo } from "@chatcoder/bot/db/sessions";
import { MessagesRepo } from "@chatcoder/bot/db/messages";
import { AdminRepo } from "@chatcoder/bot/db/admin";
import { ApiClient } from "../src/client.js";
import { Orchestrator } from "../src/orchestrator.js";
import { DaemonConfig } from "../src/config.js";
import { ToolExecutor } from "../src/toolExecutor.js";

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("system: bot ↔ daemon", () => {
  it("delivers instruction to daemon and response back", async () => {
    const handle = await openDb("sqlite::memory:");
    const sessions = new SessionsRepo(handle.db);
    const messages = new MessagesRepo(handle.db);
    const admin = new AdminRepo(handle.db);
    const app = await buildServer({
      sessionsRepo: sessions,
      messagesRepo: messages,
      adminRepo: admin
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${addr.port}`;

    const { session, rawApiKey } = await sessions.rotate({ chatId: 7 });
    await messages.enqueue({
      sessionId: session.id,
      direction: "to_daemon",
      content: "hello-world"
    });

    const client = new ApiClient({ apiUrl, apiKey: rawApiKey, retries: 0 });
    const cfg = DaemonConfig.parse({
      apiUrl,
      apiKey: rawApiKey,
      pollIntervalMs: 250,
      pollJitterMs: 0,
      heartbeatIntervalMs: 250,
      command: "echo $message"
    });
    
    const tool = new ToolExecutor({ config: cfg });
    const orch = new Orchestrator({ config: cfg, client, tool });
    orch.start();

    await waitFor(async () => (await messages.count(session.id, "to_user")) > 0, 5000);
    const delivered = await messages.dequeueOldest(session.id, "to_user");
    expect(delivered?.content).toBe("hello-world");

    const fresh = await sessions.getByApiKeyHash(session.apiKeyHash);
    expect(fresh?.lastHeartbeat).not.toBeNull();

    await orch.stop();
    await app.close();
    await handle.close();
  }, 15_000);

  it("daemon stops when session is revoked", async () => {
    const handle = await openDb("sqlite::memory:");
    const sessions = new SessionsRepo(handle.db);
    const messages = new MessagesRepo(handle.db);
    const admin = new AdminRepo(handle.db);
    const app = await buildServer({
      sessionsRepo: sessions,
      messagesRepo: messages,
      adminRepo: admin
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address() as AddressInfo;
    const apiUrl = `http://127.0.0.1:${addr.port}`;

    const { session, rawApiKey } = await sessions.rotate({ chatId: 3 });
    
    const client = new ApiClient({ apiUrl, apiKey: rawApiKey, retries: 0 });
    const cfg = DaemonConfig.parse({
      apiUrl,
      apiKey: rawApiKey,
      pollIntervalMs: 200,
      pollJitterMs: 0,
      heartbeatIntervalMs: 200
    });
    const tool = new ToolExecutor({ config: cfg });
    const orch = new Orchestrator({ config: cfg, client, tool });
    orch.start();

    await waitFor(() => orch.status === "running", 2000);
    await sessions.rotate({ chatId: 3 });
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
