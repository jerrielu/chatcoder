import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";
import {
  generateApiKey,
  hashApiKey,
  validateUserSuppliedKey
} from "../src/db/crypto.js";
import { CODE_RATE_LIMIT_MS } from "@chatcoder/shared";

let h: TestHarness;

beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.close();
});

describe("ApiKeysRepo", () => {
  it("registers a new api_key on first registerByRawKey", async () => {
    const { rawApiKey } = generateApiKey();
    const rec = await h.apiKeys.registerByRawKey(rawApiKey);
    expect(rec.apiKeyHash).toBe(hashApiKey(rawApiKey));
    expect(rec.apiKeyPrefix).toBe(rawApiKey.slice(0, 8));
    expect(rec.status).toBe("active");
  });

  it("returns the same record on subsequent registerByRawKey", async () => {
    const { rawApiKey } = generateApiKey();
    const a = await h.apiKeys.registerByRawKey(rawApiKey);
    const b = await h.apiKeys.registerByRawKey(rawApiKey);
    expect(b.id).toBe(a.id);
  });

  it("refuses to re-register a revoked api_key", async () => {
    const { rawApiKey } = generateApiKey();
    const rec = await h.apiKeys.registerByRawKey(rawApiKey);
    await h.apiKeys.revoke(rec.id);
    await expect(h.apiKeys.registerByRawKey(rawApiKey)).rejects.toThrow(/revoked/);
  });

  it("updateHeartbeat sets lastHeartbeat", async () => {
    const { rawApiKey } = generateApiKey();
    const rec = await h.apiKeys.registerByRawKey(rawApiKey);
    h.advanceTime(500);
    await h.apiKeys.updateHeartbeat(rec.id);
    const fresh = await h.apiKeys.getById(rec.id);
    expect(fresh?.lastHeartbeat).toBe(h.now());
  });

  it("list + count filter by status", async () => {
    const a = await h.apiKeys.registerByRawKey(generateApiKey().rawApiKey);
    await h.apiKeys.registerByRawKey(generateApiKey().rawApiKey);
    await h.apiKeys.revoke(a.id);
    expect(await h.apiKeys.count({ status: "active" })).toBe(1);
    expect(await h.apiKeys.count({ status: "revoked" })).toBe(1);
    expect(await h.apiKeys.count({})).toBe(2);
  });

  it("delete cascades profiles and sessions", async () => {
    const seed = await h.seedSession({ chatId: 1 });
    expect(await h.apiKeys.delete(seed.apiKey.id)).toBe(true);
    expect(await h.profiles.listByApiKey(seed.apiKey.id)).toHaveLength(0);
    expect(await h.sessions.listActiveByApiKey(seed.apiKey.id)).toHaveLength(0);
  });
});

describe("SessionsRepo", () => {
  it("create deletes old sessions and returns a new one even for the same triple", async () => {
    const seed = await h.seedSession({ chatId: 42 });
    const again = await h.sessions.create({
      chatId: 42,
      apiKeyId: seed.apiKey.id,
      profileId: seed.profile.id
    });
    // The old session was deleted and a brand-new one created.
    expect(again.id).not.toBe(seed.session.id);
    expect(await h.sessions.getById(seed.session.id)).toBeNull();
  });

  it("create deletes old sessions for the same chatId", async () => {
    const { rawApiKey } = generateApiKey();
    const apiKey = await h.apiKeys.registerByRawKey(rawApiKey);
    const [profA] = await h.profiles.upsertForApiKey(apiKey.id, [
      { name: "a", tool: "OPENAI" }
    ]);
    const first = await h.sessions.create({
      chatId: 1,
      apiKeyId: apiKey.id,
      profileId: profA!.id
    });

    const [profB] = await h.profiles.upsertForApiKey(apiKey.id, [
      { name: "b", tool: "OPENAI" }
    ]);
    const second = await h.sessions.create({
      chatId: 1,
      apiKeyId: apiKey.id,
      profileId: profB!.id
    });
    // First session is deleted entirely.
    expect(await h.sessions.getById(first.id)).toBeNull();
    const active = await h.sessions.listActiveByChatId(1);
    // Only the second session is active.
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(second.id);
  });

  it("getActiveByChatId returns the single active session (one per chat)", async () => {
    // The second create deletes the first session for the same chatId.
    const { rawApiKey } = generateApiKey();
    const apiKey = await h.apiKeys.registerByRawKey(rawApiKey);
    const [profA] = await h.profiles.upsertForApiKey(apiKey.id, [
      { name: "a", tool: "OPENAI" }
    ]);
    const first = await h.sessions.create({
      chatId: 7,
      apiKeyId: apiKey.id,
      profileId: profA!.id
    });
    h.advanceTime(100);
    const [profB] = await h.profiles.upsertForApiKey(apiKey.id, [
      { name: "b", tool: "OPENAI" }
    ]);
    const second = await h.sessions.create({
      chatId: 7,
      apiKeyId: apiKey.id,
      profileId: profB!.id
    });
    const active = await h.sessions.getActiveByChatId(7);
    // Second session is the only one remaining
    expect(active?.id).toBe(second.id);
  });

  it("revoke marks session revoked, delete removes it", async () => {
    const seed = await h.seedSession({ chatId: 5 });
    expect(await h.sessions.revoke(seed.session.id)).toBe(true);
    const row = await h.sessions.getById(seed.session.id);
    expect(row?.status).toBe("revoked");
    expect(await h.sessions.delete(seed.session.id)).toBe(true);
    expect(await h.sessions.getById(seed.session.id)).toBeNull();
  });

  it("tryConsumeRate per-session — one session is not throttled by another", async () => {
    // Different chatIds so creating one does not delete the other.
    const seedA = await h.seedSession({ chatId: 1, profileName: "a" });
    const { rawApiKey } = generateApiKey();
    const apiKey = await h.apiKeys.registerByRawKey(rawApiKey);
    const [prof] = await h.profiles.upsertForApiKey(apiKey.id, [
      { name: "b", tool: "OPENAI" }
    ]);
    const sessionB = await h.sessions.create({
      chatId: 2,
      apiKeyId: apiKey.id,
      profileId: prof!.id
    });
    expect(await h.sessions.tryConsumeRate(seedA.session.id)).toBe(true);
    expect(await h.sessions.tryConsumeRate(sessionB.id)).toBe(true);
    expect(await h.sessions.tryConsumeRate(seedA.session.id)).toBe(false);
    h.advanceTime(CODE_RATE_LIMIT_MS + 10);
    expect(await h.sessions.tryConsumeRate(seedA.session.id)).toBe(true);
  });
});

describe("shared key helpers", () => {
  it("generateApiKey returns a prefixed url-safe key", () => {
    const { rawApiKey, prefix } = generateApiKey();
    expect(rawApiKey.startsWith("cc_")).toBe(true);
    expect(prefix).toBe(rawApiKey.slice(0, 8));
    expect(rawApiKey).not.toMatch(/[+/=]/);
  });
  it("validateUserSuppliedKey rejects whitespace and short keys", () => {
    expect(() => validateUserSuppliedKey("has space-xxxxxx")).toThrow(/whitespace/);
    expect(() => validateUserSuppliedKey("short")).toThrow(/at least/);
    expect(() => validateUserSuppliedKey("cc_" + "x".repeat(16))).not.toThrow();
  });
});
