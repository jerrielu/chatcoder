import { describe, it, expect } from "vitest";
import { fmtTs, fmtAge, heartbeatState } from "../src/util/time";

describe("fmtTs", () => {
  it("formats epoch ms to ISO-ish UTC", () => {
    expect(fmtTs(0)).toBe("1970-01-01 00:00:00Z");
  });
  it("returns dash for null/undefined", () => {
    expect(fmtTs(null)).toBe("—");
    expect(fmtTs(undefined)).toBe("—");
  });
});

describe("fmtAge", () => {
  it("returns 0s under 1 second", () => {
    expect(fmtAge(0)).toBe("0s");
    expect(fmtAge(999)).toBe("0s");
  });
  it("seconds under a minute", () => {
    expect(fmtAge(5_000)).toBe("5s");
  });
  it("minutes under an hour", () => {
    expect(fmtAge(120_000)).toBe("2m");
  });
  it("hours otherwise", () => {
    expect(fmtAge(3_600_000 * 4)).toBe("4h");
  });
});

describe("heartbeatState", () => {
  const stale = 60_000;
  it("never when null", () => {
    expect(heartbeatState(null, 1_000, stale)).toBe("never");
  });
  it("online within stale window", () => {
    expect(heartbeatState(1_000, 2_000, stale)).toBe("online");
  });
  it("offline beyond stale window", () => {
    expect(heartbeatState(1_000, 100_000, stale)).toBe("offline");
  });
});
