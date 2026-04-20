import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import {
  generateApiKey,
  hashApiKey,
  validateUserSuppliedKey
} from "../src/db/sessions.js";
import { CODE_RATE_LIMIT_MS } from "@chatcoder/shared";

let h: TestHarness;

beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.close();
});

describe("SessionsRepo.rotate", () => {
  it("creates a session and returns the raw key", async () => {
    const { session, rawApiKey } = await h.sessions.rotate({ chatId: 42 });
    expect(session.chatId).toBe(42);
    expect(rawApiKey.startsWith("cc_")).toBe(true);
    expect(session.apiKeyHash).toBe(hashApiKey(rawApiKey));
  });

  it("revokes the previous active session on rotation", async () => {
    const a = await h.sessions.rotate({ chatId: 1 });
    h.advanceTime(10);
    const b = await h.sessions.rotate({ chatId: 1 });
    const oldRow = await h.sessions.getByApiKeyHash(a.session.apiKeyHash);
    expect(oldRow?.status).toBe("revoked");
    expect(oldRow?.revokedAt).not.toBeNull();
    expect(b.session.status).toBe("active");
  });

  it("accepts a user-supplied key and stores hash", async () => {
    const key = "my-own-key-" + "x".repeat(8);
    const r = await h.sessions.rotate({ chatId: 7, rawApiKey: key });
    expect(r.rawApiKey).toBe(key);
    const row = await h.sessions.getByApiKeyHash(hashApiKey(key));
    expect(row?.id).toBe(r.session.id);
  });

  it("rejects duplicate key reuse across users", async () => {
    const key = "shared-key-" + "y".repeat(8);
    await h.sessions.rotate({ chatId: 1, rawApiKey: key });
    await expect(
      h.sessions.rotate({ chatId: 2, rawApiKey: key })
    ).rejects.toThrow(/already in use/);
  });

  it("rejects a too-short user key", async () => {
    await expect(
      h.sessions.rotate({ chatId: 1, rawApiKey: "short" })
    ).rejects.toThrow(/at least/);
  });

  it("rejects whitespace in a user key", () => {
    expect(() => validateUserSuppliedKey("has space-xxxxxx")).toThrow(/whitespace/);
  });
});

describe("SessionsRepo heartbeat + rate limit", () => {
  it("updateHeartbeat sets lastHeartbeat to now()", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    h.advanceTime(500);
    await h.sessions.updateHeartbeat(session.id);
    const s = await h.sessions.getByApiKeyHash(session.apiKeyHash);
    expect(s?.lastHeartbeat).toBe(h.now());
  });

  it("tryConsumeRate accepts first call, rejects within 1 s, accepts after", async () => {
    const { session } = await h.sessions.rotate({ chatId: 1 });
    expect(await h.sessions.tryConsumeRate(session.id)).toBe(true);
    h.advanceTime(CODE_RATE_LIMIT_MS - 100);
    expect(await h.sessions.tryConsumeRate(session.id)).toBe(false);
    h.advanceTime(200);
    expect(await h.sessions.tryConsumeRate(session.id)).toBe(true);
  });
});

describe("getActiveByChatId", () => {
  it("returns only active", async () => {
    await h.sessions.rotate({ chatId: 1 });
    h.advanceTime(1);
    await h.sessions.rotate({ chatId: 1 });
    const active = await h.sessions.getActiveByChatId(1);
    expect(active?.status).toBe("active");
  });

  it("returns null when no session exists", async () => {
    expect(await h.sessions.getActiveByChatId(999)).toBeNull();
  });
});

describe("generateApiKey", () => {
  it("generates a prefixed url-safe key", () => {
    const { rawApiKey, prefix } = generateApiKey();
    expect(rawApiKey.startsWith("cc_")).toBe(true);
    expect(prefix).toBe(rawApiKey.slice(0, 8));
    expect(rawApiKey).not.toMatch(/[+/=]/);
  });
});
