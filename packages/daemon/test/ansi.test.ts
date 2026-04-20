import { describe, it, expect } from "vitest";
import { stripAnsi } from "../src/ansi.js";

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });
  it("removes cursor/erase codes", () => {
    expect(stripAnsi("a\u001b[2Kb")).toBe("ab");
  });
  it("leaves plain text alone", () => {
    expect(stripAnsi("plain text 123")).toBe("plain text 123");
  });
});
