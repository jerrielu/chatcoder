import { describe, it, expect } from "vitest";
import { BOT_API_URL, HEARTBEAT_STALE_MS } from "../src/config";

describe("dashboard config", () => {
  it("exposes a BOT_API_URL string", () => {
    expect(typeof BOT_API_URL).toBe("string");
    expect(BOT_API_URL.length).toBeGreaterThan(0);
  });
  it("defines a positive heartbeat-stale window", () => {
    expect(HEARTBEAT_STALE_MS).toBeGreaterThan(0);
  });
});
