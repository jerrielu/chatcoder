import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DbHandle } from "../src/db/index.js";
import { SessionsRepo } from "../src/db/sessions.js";
import { MessagesRepo } from "../src/db/messages.js";
import { AdminRepo } from "../src/db/admin.js";

interface TestHarness {
  handle: DbHandle;
  sessions: SessionsRepo;
  messages: MessagesRepo;
  admin: AdminRepo;
  now: () => number;
  advanceTime: (ms: number) => void;
}

async function makeHarness(): Promise<TestHarness> {
  const handle = await openDb("sqlite::memory:");
  let t = 1_000_000;
  const now = (): number => t;
  return {
    handle,
    sessions: new SessionsRepo(handle.db, now),
    messages: new MessagesRepo(handle.db, now),
    admin: new AdminRepo(handle.db, now),
    now,
    advanceTime: (ms): void => {
      t += ms;
    }
  };
}

let h: TestHarness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.handle.close();
});

describe("AdminRepo.listSessions", () => {
  it("orders sessions newest-first and applies status + chatId filters", async () => {
    const a = await h.sessions.rotate({ chatId: 1 });
    h.advanceTime(10);
    const b = await h.sessions.rotate({ chatId: 2 });
    h.advanceTime(10);
    const c = await h.sessions.rotate({ chatId: 1 }); // revokes a

    const all = await h.admin.listSessions();
    expect(all.map((s) => s.id)).toEqual([c.session.id, b.session.id, a.session.id]);

    const onlyActive = await h.admin.listSessions({ status: "active" });
    expect(onlyActive.map((s) => s.id).sort()).toEqual([b.session.id, c.session.id].sort());

    const onlyRevoked = await h.admin.listSessions({ status: "revoked" });
    expect(onlyRevoked.map((s) => s.id)).toEqual([a.session.id]);

    const onlyChat1 = await h.admin.listSessions({ chatId: 1 });
    expect(onlyChat1.map((s) => s.id)).toEqual([c.session.id, a.session.id]);
  });

  it("respects limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      h.advanceTime(1);
      await h.sessions.rotate({ chatId: 100 + i });
    }
    const page1 = await h.admin.listSessions({ limit: 2, offset: 0 });
    const page2 = await h.admin.listSessions({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
  });

  it("counts sessions accurately", async () => {
    await h.sessions.rotate({ chatId: 1 });
    await h.sessions.rotate({ chatId: 1 }); // revokes first
    await h.sessions.rotate({ chatId: 2 });
    expect(await h.admin.countSessions()).toBe(3);
    expect(await h.admin.countSessions({ status: "active" })).toBe(2);
    expect(await h.admin.countSessions({ status: "revoked" })).toBe(1);
    expect(await h.admin.countSessions({ chatId: 1 })).toBe(2);
  });
});

describe("AdminRepo.getSessionById / deleteSession / updateSession / revokeSession", () => {
  it("returns a session and null when absent", async () => {
    const r = await h.sessions.rotate({ chatId: 1 });
    const got = await h.admin.getSessionById(r.session.id);
    expect(got?.id).toBe(r.session.id);
    expect(await h.admin.getSessionById("nope")).toBeNull();
  });

  it("revokes only active sessions and returns true/false accordingly", async () => {
    const r = await h.sessions.rotate({ chatId: 1 });
    expect(await h.admin.revokeSession(r.session.id)).toBe(true);
    expect((await h.admin.getSessionById(r.session.id))?.status).toBe("revoked");
    expect(await h.admin.revokeSession(r.session.id)).toBe(false);
    expect(await h.admin.revokeSession("missing")).toBe(false);
  });

  it("delete removes the row and cascades messages", async () => {
    const r = await h.sessions.rotate({ chatId: 1 });
    await h.messages.enqueue({ sessionId: r.session.id, direction: "to_daemon", content: "x" });
    expect(await h.admin.deleteSession(r.session.id)).toBe(true);
    expect(await h.admin.getSessionById(r.session.id)).toBeNull();
    expect(await h.admin.listMessages(r.session.id)).toEqual([]);
    expect(await h.admin.deleteSession(r.session.id)).toBe(false);
  });

  it("updates chatId and returns true/false accordingly", async () => {
    const r = await h.sessions.rotate({ chatId: 1 });
    expect(await h.admin.updateSession(r.session.id, { chatId: 99 })).toBe(true);
    expect((await h.admin.getSessionById(r.session.id))?.chatId).toBe(99);
    expect(await h.admin.updateSession("missing", { chatId: 100 })).toBe(false);
  });
});

describe("AdminRepo message ops", () => {
  it("lists, filters by direction, gets, updates, deletes", async () => {
    const r = await h.sessions.rotate({ chatId: 1 });
    const sid = r.session.id;
    const m1 = await h.messages.enqueue({ sessionId: sid, direction: "to_daemon", content: "instr" });
    const m2 = await h.messages.enqueue({ sessionId: sid, direction: "to_user", content: "resp" });

    const all = await h.admin.listMessages(sid);
    expect(all).toHaveLength(2);

    const onlyDaemon = await h.admin.listMessages(sid, "to_daemon");
    expect(onlyDaemon.map((m) => m.id)).toEqual([m1.message.id]);

    const got = await h.admin.getMessageById(m2.message.id);
    expect(got?.content).toBe("resp");
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
