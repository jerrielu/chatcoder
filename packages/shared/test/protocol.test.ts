import { describe, it, expect } from "vitest";
import {
  DaemonMessage,
  PollResponse,
  PostResponseBody,
  HeartbeatBody,
  SessionInfoResponse,
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
  });
  it("rejects empty content", () => {
    expect(() => DaemonMessage.parse({ id: "a", content: "", createdAt: 0 })).toThrow();
  });
  it("rejects instruction > MAX_INSTRUCTION_BYTES", () => {
    expect(() =>
      DaemonMessage.parse({ id: "a", content: "x".repeat(MAX_INSTRUCTION_BYTES + 1), createdAt: 0 })
    ).toThrow();
  });
  it("parses PollResponse", () => {
    const r = PollResponse.parse({ reset: false, sessionValid: true, messages: [] });
    expect(r.messages).toEqual([]);
  });
  it("rejects PostResponseBody over MAX_RESPONSE_BYTES", () => {
    expect(() =>
      PostResponseBody.parse({ content: "x".repeat(MAX_RESPONSE_BYTES + 1) })
    ).toThrow();
  });
  it("accepts HeartbeatBody with optional fields", () => {
    expect(HeartbeatBody.parse({})).toEqual({});
    expect(HeartbeatBody.parse({ version: "0.1.0", note: "ok" }).note).toBe("ok");
  });
  it("parses SessionInfoResponse", () => {
    const s = SessionInfoResponse.parse({
      sessionId: "s",
      apiKeyPrefix: "cc_abcd",
      createdAt: 0,
      status: "active",
      pendingInstructions: 0,
      pendingResponses: 0,
      lastHeartbeat: null
    });
    expect(s.status).toBe("active");
  });
  it("exposes API_PATHS and queue depth constants", () => {
    expect(API_PATHS.heartbeat).toBe("/v1/heartbeat");
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
