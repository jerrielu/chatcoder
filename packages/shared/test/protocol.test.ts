import { describe, it, expect } from "vitest";
import {
  DaemonMessage,
  DaemonRegisterBody,
  DaemonRegisterResponse,
  PollResponse,
  PostResponseBody,
  HeartbeatBody,
  MAX_INSTRUCTION_BYTES,
  MAX_RESPONSE_BYTES,
  API_PATHS,
  MAX_QUEUE_DEPTH,
  MIN_API_KEY_LENGTH,
  ApiError,
  ERROR_CODES
} from "../src/index.js";

describe("protocol schemas", () => {
  it("parses a valid DaemonMessage", () => {
    const m = DaemonMessage.parse({ id: "a", content: "hi", createdAt: 100 });
    expect(m.content).toBe("hi");
    expect(m.resumeLastSession).toBe(true);
  });
  it("rejects empty content", () => {
    expect(() => DaemonMessage.parse({ id: "a", content: "", createdAt: 0 })).toThrow();
  });
  it("rejects instruction > MAX_INSTRUCTION_BYTES", () => {
    expect(() =>
      DaemonMessage.parse({ id: "a", content: "x".repeat(MAX_INSTRUCTION_BYTES + 1), createdAt: 0 })
    ).toThrow();
  });
  it("parses PollResponse with grouped sessions", () => {
    const r = PollResponse.parse({
      reset: false,
      sessions: [
        {
          sessionId: "s1",
          profileName: "main",
          messages: [{ id: "m1", content: "hi", createdAt: 100 }]
        }
      ]
    });
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]!.profileName).toBe("main");
  });
  it("rejects PostResponseBody over MAX_RESPONSE_BYTES", () => {
    expect(() =>
      PostResponseBody.parse({ sessionId: "s", content: "x".repeat(MAX_RESPONSE_BYTES + 1) })
    ).toThrow();
  });
  it("requires sessionId on PostResponseBody", () => {
    expect(() => PostResponseBody.parse({ content: "hi" })).toThrow();
  });
  it("accepts HeartbeatBody with optional fields", () => {
    expect(HeartbeatBody.parse({})).toEqual({});
    expect(HeartbeatBody.parse({ version: "0.1.0", note: "ok" }).note).toBe("ok");
  });
  it("parses DaemonRegisterBody", () => {
    const r = DaemonRegisterBody.parse({
      profiles: [
        { name: "main", tool: "CLAUDE_CODE" },
        { name: "ops", tool: "OPENAI", metadata: "server work" }
      ]
    });
    expect(r.profiles).toHaveLength(2);
    expect(r.profiles[1]!.metadata).toBe("server work");
  });
  it("rejects invalid profile names in register body", () => {
    expect(() =>
      DaemonRegisterBody.parse({ profiles: [{ name: "bad name", tool: "CUSTOM" }] })
    ).toThrow();
  });
  it("parses DaemonRegisterResponse", () => {
    const r = DaemonRegisterResponse.parse({
      apiKeyId: "a1",
      profiles: [{ id: "p1", name: "main", tool: "CLAUDE_CODE" }]
    });
    expect(r.profiles[0]!.id).toBe("p1");
  });
  it("exposes API_PATHS and queue depth constants", () => {
    expect(API_PATHS.heartbeat).toBe("/v1/heartbeat");
    expect(API_PATHS.daemonRegister).toBe("/v1/daemon/register");
    expect(MAX_QUEUE_DEPTH).toBe(10);
    expect(MIN_API_KEY_LENGTH).toBeGreaterThan(0);
  });
});

describe("ApiError envelope", () => {
  it("maps codes to http status", () => {
    expect(ApiError.unauthorized().httpStatus).toBe(401);
    expect(ApiError.sessionRevoked().httpStatus).toBe(410);
    expect(ApiError.rateLimited().httpStatus).toBe(429);
    expect(ApiError.queueFull().httpStatus).toBe(409);
    expect(ApiError.validation("x").httpStatus).toBe(400);
    expect(ApiError.internal().httpStatus).toBe(500);
  });
  it("serializes envelope", () => {
    const env = ApiError.sessionRevoked().toEnvelope();
    expect(env.error.code).toBe(ERROR_CODES.SESSION_REVOKED);
  });
});
