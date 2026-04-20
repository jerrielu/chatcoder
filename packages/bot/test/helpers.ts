import { openDb } from "../src/db/index.js";
import { SessionsRepo } from "../src/db/sessions.js";
import { MessagesRepo } from "../src/db/messages.js";
import { AdminRepo } from "../src/db/admin.js";

export interface TestHarness {
  sessions: SessionsRepo;
  messages: MessagesRepo;
  admin: AdminRepo;
  close: () => Promise<void>;
  now: () => number;
  advanceTime: (ms: number) => void;
}

export async function makeHarness(): Promise<TestHarness> {
  const handle = await openDb("sqlite::memory:");
  let t = 1_000_000;
  const now = (): number => t;
  const sessions = new SessionsRepo(handle.db, now);
  const messages = new MessagesRepo(handle.db, now);
  const admin = new AdminRepo(handle.db, now);
  return {
    sessions,
    messages,
    admin,
    close: handle.close,
    now,
    advanceTime: (ms) => {
      t += ms;
    }
  };
}
