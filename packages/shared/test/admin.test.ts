import { describe, it, expect } from "vitest";
import {
  ADMIN_API_PATHS,
  ADMIN_API_PREFIX,
  AdminMessage,
  AdminSession,
  CreateSessionBody,
  CreateSessionResponse,
  EnqueueMessageBody,
  EnqueueMessageResponse,
  ListMessagesQuery,
  ListMessagesResponse,
  ListSessionsQuery,
  ListSessionsResponse,
  MAX_INSTRUCTION_BYTES,
  MAX_RESPONSE_BYTES,
  RotateSessionBody,
  SessionDetailResponse,
  UpdateMessageBody,
  UpdateSessionBody
} from "../src/index.js";

describe("ADMIN_API_PATHS path builders", () => {
  it("mounts everything under ADMIN_API_PREFIX", () => {
    expect(ADMIN_API_PREFIX).toBe("/v1/admin");
    expect(ADMIN_API_PATHS.sessions).toBe("/v1/admin/sessions");
    expect(ADMIN_API_PATHS.session("abc")).toBe("/v1/admin/sessions/abc");
    expect(ADMIN_API_PATHS.sessionDetail("abc")).toBe("/v1/admin/sessions/abc/detail");
    expect(ADMIN_API_PATHS.rotate("abc")).toBe("/v1/admin/sessions/abc/rotate");
    expect(ADMIN_API_PATHS.revoke("abc")).toBe("/v1/admin/sessions/abc/revoke");
    expect(ADMIN_API_PATHS.purge("abc")).toBe("/v1/admin/sessions/abc/purge");
    expect(ADMIN_API_PATHS.messages("abc")).toBe("/v1/admin/sessions/abc/messages");
    expect(ADMIN_API_PATHS.message("m1")).toBe("/v1/admin/messages/m1");
  });

  it("URI-encodes path segments", () => {
    expect(ADMIN_API_PATHS.session("a/b")).toBe("/v1/admin/sessions/a%2Fb");
    expect(ADMIN_API_PATHS.message("x y")).toBe("/v1/admin/messages/x%20y");
  });
});

describe("admin wire schemas", () => {
  const sampleSession = {
    id: "s1",
    chatId: 42,
    apiKeyPrefix: "cc_abcd",
    status: "active" as const,
    createdAt: 0,
    revokedAt: null,
    lastHeartbeat: null
  };

  it("parses AdminSession + AdminMessage", () => {
    expect(AdminSession.parse(sampleSession).chatId).toBe(42);
    expect(
      AdminMessage.parse({
        id: "m1",
        sessionId: "s1",
        direction: "to_user",
        content: "hi",
        createdAt: 1
      }).direction
    ).toBe("to_user");
  });

  it("ListSessionsQuery coerces strings to numbers", () => {
    const q = ListSessionsQuery.parse({ chatId: "7", limit: "3", offset: "6" });
    expect(q.chatId).toBe(7);
    expect(q.limit).toBe(3);
    expect(q.offset).toBe(6);
  });

  it("ListSessionsResponse parses", () => {
    const r = ListSessionsResponse.parse({ sessions: [sampleSession], total: 1 });
    expect(r.total).toBe(1);
  });

  it("CreateSessionBody rejects too-short key and accepts empty string as undefined", () => {
    expect(() => CreateSessionBody.parse({ chatId: 1, rawApiKey: "short" })).toThrow();
    const parsed = CreateSessionBody.parse({ chatId: 1, rawApiKey: "" });
    expect(parsed.rawApiKey).toBeUndefined();
  });

  it("CreateSessionResponse parses", () => {
    const r = CreateSessionResponse.parse({ session: sampleSession, rawApiKey: "k" });
    expect(r.rawApiKey).toBe("k");
  });

  it("RotateSessionBody accepts empty input", () => {
    expect(RotateSessionBody.parse({}).rawApiKey).toBeUndefined();
  });

  it("UpdateSessionBody requires chatId", () => {
    expect(() => UpdateSessionBody.parse({})).toThrow();
    expect(UpdateSessionBody.parse({ chatId: "9" }).chatId).toBe(9);
  });

  it("SessionDetailResponse parses", () => {
    const r = SessionDetailResponse.parse({
      session: sampleSession,
      pendingToDaemon: 1,
      pendingToUser: 2,
      messages: []
    });
    expect(r.pendingToDaemon).toBe(1);
    expect(r.pendingToUser).toBe(2);
  });

  it("EnqueueMessageBody refines on direction", () => {
    // OK: short content for to_daemon
    expect(
      EnqueueMessageBody.parse({ direction: "to_daemon", content: "hi" }).content
    ).toBe("hi");
    // OK: long (but <= 32KB) content for to_user
    const big = "x".repeat(MAX_INSTRUCTION_BYTES + 1);
    expect(() => EnqueueMessageBody.parse({ direction: "to_daemon", content: big })).toThrow();
    expect(
      EnqueueMessageBody.parse({ direction: "to_user", content: big }).content.length
    ).toBe(MAX_INSTRUCTION_BYTES + 1);
    // Too big for to_user
    const huge = "x".repeat(MAX_RESPONSE_BYTES + 1);
    expect(() => EnqueueMessageBody.parse({ direction: "to_user", content: huge })).toThrow();
  });

  it("EnqueueMessageResponse parses", () => {
    const r = EnqueueMessageResponse.parse({
      message: {
        id: "m1",
        sessionId: "s1",
        direction: "to_daemon",
        content: "x",
        createdAt: 1
      },
      droppedOldestId: null
    });
    expect(r.droppedOldestId).toBeNull();
  });

  it("UpdateMessageBody caps content length", () => {
    expect(UpdateMessageBody.parse({ content: "x" }).content).toBe("x");
    expect(() =>
      UpdateMessageBody.parse({ content: "x".repeat(MAX_RESPONSE_BYTES + 1) })
    ).toThrow();
  });

  it("ListMessagesQuery is fully optional", () => {
    expect(ListMessagesQuery.parse({}).direction).toBeUndefined();
    expect(ListMessagesQuery.parse({ direction: "to_user" }).direction).toBe("to_user");
  });

  it("ListMessagesResponse parses", () => {
    expect(ListMessagesResponse.parse({ messages: [] }).messages).toEqual([]);
  });
});
