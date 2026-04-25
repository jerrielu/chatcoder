import { openDb } from "../src/db/index.js";
import { ApiKeysRepo } from "../src/db/apiKeys.js";
import { ProfilesRepo } from "../src/db/profiles.js";
import { SessionsRepo } from "../src/db/sessions.js";
import { MessagesRepo } from "../src/db/messages.js";
import { AdminRepo } from "../src/db/admin.js";
import { generateApiKey, hashApiKey } from "../src/db/crypto.js";
import type { ProfileRecord } from "../src/db/profiles.js";
import type { ApiKeyRecord } from "../src/db/apiKeys.js";
import type { Session } from "../src/db/sessions.js";

export interface TestHarness {
  apiKeys: ApiKeysRepo;
  profiles: ProfilesRepo;
  sessions: SessionsRepo;
  messages: MessagesRepo;
  admin: AdminRepo;
  close: () => Promise<void>;
  now: () => number;
  advanceTime: (ms: number) => void;
  /** Register an api_key + profiles and create a session linking the chat. */
  seedSession: (args: {
    chatId: number;
    profileName?: string;
    tool?: ProfileRecord["tool"];
  }) => Promise<{ apiKey: ApiKeyRecord; profile: ProfileRecord; session: Session; rawApiKey: string }>;
}

export async function makeHarness(): Promise<TestHarness> {
  const handle = await openDb("sqlite::memory:");
  let t = 1_000_000;
  const now = (): number => t;
  const apiKeys = new ApiKeysRepo(handle.db, now);
  const profiles = new ProfilesRepo(handle.db, now);
  const sessions = new SessionsRepo(handle.db, now);
  const messages = new MessagesRepo(handle.db, now);
  const admin = new AdminRepo(handle.db, now);

  const seedSession: TestHarness["seedSession"] = async ({
    chatId,
    profileName = "main",
    tool = "CLAUDE_CODE"
  }) => {
    const { rawApiKey } = generateApiKey();
    const apiKey = await apiKeys.registerByRawKey(rawApiKey);
    const [profile] = await profiles.upsertForApiKey(apiKey.id, [
      { name: profileName, tool }
    ]);
    const session = await sessions.create({
      chatId,
      apiKeyId: apiKey.id,
      profileId: profile!.id
    });
    return { apiKey, profile: profile!, session, rawApiKey };
  };

  return {
    apiKeys,
    profiles,
    sessions,
    messages,
    admin,
    close: handle.close,
    now,
    advanceTime: (ms) => {
      t += ms;
    },
    seedSession
  };
}

export { hashApiKey };
