import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeHarness, type TestHarness } from "./helpers.js";

let h: TestHarness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.close();
});

describe("AdminRepo.listSessions", () => {
  it("orders sessions newest-first and applies status + chatId filters", async () => {
    const a = await h.seedSession({ chatId: 1, profileName: "p-a" });
    h.advanceTime(10);
    const b = await h.seedSession({ chatId: 2, profileName: "p-b" });
    h.advanceTime(10);
    const c = await h.seedSession({ chatId: 1, profileName: "p-c" });

    const all = await h.admin.listSessions();
    expect(all.map((s) => s.session.id)).toEqual([
      c.session.id,
      b.session.id,
      a.session.id
    ]);

    const onlyActive = await h.admin.listSessions({ status: "active" });
    expect(onlyActive).toHaveLength(3);

    const onlyChat1 = await h.admin.listSessions({ chatId: 1 });
    expect(onlyChat1.map((s) => s.session.id)).toEqual([c.session.id, a.session.id]);
  });

  it("respects limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      h.advanceTime(1);
      await h.seedSession({ chatId: 100 + i, profileName: `p${i}` });
    }
    const page1 = await h.admin.listSessions({ limit: 2, offset: 0 });
    const page2 = await h.admin.listSessions({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.session.id).not.toBe(page2[0]!.session.id);
  });

  it("counts sessions accurately", async () => {
    await h.seedSession({ chatId: 1, profileName: "a" });
    await h.seedSession({ chatId: 1, profileName: "b" });
    await h.seedSession({ chatId: 2, profileName: "c" });
    expect(await h.admin.countSessions()).toBe(3);
    expect(await h.admin.countSessions({ chatId: 1 })).toBe(2);
  });

  it("filters by apiKeyId", async () => {
    const a = await h.seedSession({ chatId: 1, profileName: "a" });
    await h.seedSession({ chatId: 2, profileName: "b" });
    const filtered = await h.admin.listSessions({ apiKeyId: a.apiKey.id });
    expect(filtered.map((s) => s.session.id)).toEqual([a.session.id]);
  });
});

describe("AdminRepo.getSessionById / deleteSession", () => {
  it("returns joined row and null when absent", async () => {
    const r = await h.seedSession({ chatId: 1 });
    const got = await h.admin.getSessionById(r.session.id);
    expect(got?.session.id).toBe(r.session.id);
    expect(got?.profile.name).toBe("main");
    expect(got?.apiKey.apiKeyPrefix).toBe(r.apiKey.apiKeyPrefix);
    expect(await h.admin.getSessionById("nope")).toBeNull();
  });

  it("delete removes the row and cascades messages", async () => {
    const r = await h.seedSession({ chatId: 1 });
    await h.messages.enqueue({ sessionId: r.session.id, content: "x" });
    expect(await h.admin.deleteSession(r.session.id)).toBe(true);
    expect(await h.admin.getSessionById(r.session.id)).toBeNull();
    expect(await h.admin.listMessages(r.session.id)).toEqual([]);
    expect(await h.admin.deleteSession(r.session.id)).toBe(false);
  });
});

describe("AdminRepo message ops", () => {
  it("lists, gets, updates, deletes", async () => {
    const r = await h.seedSession({ chatId: 1 });
    const sid = r.session.id;
    const m1 = await h.messages.enqueue({ sessionId: sid, content: "instr-a" });
    const m2 = await h.messages.enqueue({ sessionId: sid, content: "instr-b" });

    const all = await h.admin.listMessages(sid);
    expect(all.map((m) => m.id)).toEqual([m1.message.id, m2.message.id]);

    const got = await h.admin.getMessageById(m2.message.id);
    expect(got?.content).toBe("instr-b");
    expect(await h.admin.getMessageById("nope")).toBeNull();

    expect(await h.admin.updateMessageContent(m2.message.id, "edited")).toBe(true);
    const after = await h.admin.getMessageById(m2.message.id);
    expect(after?.content).toBe("edited");
    expect(await h.admin.updateMessageContent("nope", "x")).toBe(false);

    expect(await h.admin.deleteMessage(m1.message.id)).toBe(true);
    expect(await h.admin.deleteMessage(m1.message.id)).toBe(false);
    expect((await h.admin.listMessages(sid)).map((m) => m.id)).toEqual([m2.message.id]);
  });
});
