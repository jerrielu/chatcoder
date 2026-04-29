import { describe, it, expect } from "vitest";
import {
  ADMIN_API_PATHS,
  ADMIN_API_PREFIX,
  AdminApiKey,
  AdminMessage,
  AdminProfile,
  AdminSession,
  ApiKeyDetailResponse,
  EnqueueMessageBody,
  EnqueueMessageResponse,
  ListApiKeysResponse,
  ListMessagesResponse,
  ListSessionsQuery,
  ListSessionsResponse,
  MAX_INSTRUCTION_BYTES,
  SessionDetailResponse,
  UpdateMessageBody
} from "../src/index.js";

describe("ADMIN_API_PATHS path builders", () => {
  it("mounts everything under ADMIN_API_PREFIX", () => {
    expect(ADMIN_API_PREFIX).toBe("/v1/admin");
    expect(ADMIN_API_PATHS.apiKeys).toBe("/v1/admin/api-keys");
    expect(ADMIN_API_PATHS.apiKey("k1")).toBe("/v1/admin/api-keys/k1");
    expect(ADMIN_API_PATHS.apiKeyProfiles("k1")).toBe(
      "/v1/admin/api-keys/k1/profiles"
    );
    expect(ADMIN_API_PATHS.sessions).toBe("/v1/admin/sessions");
    expect(ADMIN_API_PATHS.session("abc")).toBe("/v1/admin/sessions/abc");
    expect(ADMIN_API_PATHS.sessionDetail("abc")).toBe("/v1/admin/sessions/abc/detail");
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
  const sampleApiKey = {
    id: "a1",
    apiKeyPrefix: "cc_abcd",
    status: "active" as const,
    createdAt: 0,
    revokedAt: null,
    lastHeartbeat: null
  };
  const sampleProfile = {
    id: "p1",
    apiKeyId: "a1",
    name: "main",
    tool: "CLAUDE_CODE" as const,
    metadata: null,
    createdAt: 0
  };
  const sampleSession = {
    id: "s1",
    chatId: 42,
    apiKeyId: "a1",
    apiKeyPrefix: "cc_abcd",
    apiKeyLastHeartbeat: null,
    profileId: "p1",
    profileName: "main",
    profileTool: "CLAUDE_CODE" as const,
    status: "active" as const,
    createdAt: 0,
    revokedAt: null
  };

  it("parses AdminApiKey", () => {
    expect(AdminApiKey.parse(sampleApiKey).apiKeyPrefix).toBe("cc_abcd");
  });

  it("parses AdminProfile", () => {
    expect(AdminProfile.parse(sampleProfile).name).toBe("main");
  });

  it("parses AdminSession + AdminMessage", () => {
    expect(AdminSession.parse(sampleSession).chatId).toBe(42);
    expect(
      AdminMessage.parse({
        id: "m1",
        sessionId: "s1",
        content: "hi",
        createdAt: 1
      }).resumeLastSession
    ).toBe(true);
    expect(
      AdminMessage.parse({
        id: "m1",
        sessionId: "s1",
        content: "hi",
        codexReasoningEffort: "high",
        createdAt: 1
      }).codexReasoningEffort
    ).toBe("high");
  });

  it("ListSessionsQuery coerces strings to numbers", () => {
    const q = ListSessionsQuery.parse({ chatId: "7", limit: "3", offset: "6" });
    expect(q.chatId).toBe(7);
    expect(q.limit).toBe(3);
    expect(q.offset).toBe(6);
  });

  it("ListSessionsQuery accepts apiKeyId", () => {
    const q = ListSessionsQuery.parse({ apiKeyId: "a1" });
    expect(q.apiKeyId).toBe("a1");
  });

  it("ListSessionsResponse parses", () => {
    const r = ListSessionsResponse.parse({ sessions: [sampleSession], total: 1 });
    expect(r.total).toBe(1);
  });

  it("ListApiKeysResponse parses", () => {
    const r = ListApiKeysResponse.parse({ apiKeys: [sampleApiKey], total: 1 });
    expect(r.total).toBe(1);
  });

  it("ApiKeyDetailResponse parses", () => {
    const r = ApiKeyDetailResponse.parse({
      apiKey: sampleApiKey,
      profiles: [sampleProfile],
      sessions: [sampleSession]
    });
    expect(r.profiles[0]!.tool).toBe("CLAUDE_CODE");
  });

  it("SessionDetailResponse parses", () => {
    const r = SessionDetailResponse.parse({
      session: sampleSession,
      pending: 1,
      messages: []
    });
    expect(r.pending).toBe(1);
  });

  it("EnqueueMessageBody caps content at MAX_INSTRUCTION_BYTES", () => {
    expect(EnqueueMessageBody.parse({ content: "hi" }).content).toBe("hi");
    expect(EnqueueMessageBody.parse({ content: "hi" }).resumeLastSession).toBeUndefined();
    expect(EnqueueMessageBody.parse({ content: "hi" }).codexReasoningEffort).toBeUndefined();
    expect(() =>
      EnqueueMessageBody.parse({ content: "x".repeat(MAX_INSTRUCTION_BYTES + 1) })
    ).toThrow();
  });

  it("EnqueueMessageResponse parses", () => {
    const r = EnqueueMessageResponse.parse({
      message: {
        id: "m1",
        sessionId: "s1",
        content: "x",
        resumeLastSession: false,
        codexReasoningEffort: "low",
        createdAt: 1
      },
      droppedOldestId: null
    });
    expect(r.droppedOldestId).toBeNull();
  });

  it("UpdateMessageBody caps content length", () => {
    expect(UpdateMessageBody.parse({ content: "x" }).content).toBe("x");
    expect(() =>
      UpdateMessageBody.parse({ content: "x".repeat(MAX_INSTRUCTION_BYTES + 1) })
    ).toThrow();
  });

  it("ListMessagesResponse parses", () => {
    expect(ListMessagesResponse.parse({ messages: [] }).messages).toEqual([]);
  });
});
