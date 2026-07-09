import { describe, it, expect } from "vitest";
import { extractResponseFromJSON, extractLastBlock } from "../src/summary.js";

describe("extractResponseFromJSON", () => {
  it("extracts response from plain JSON", () => {
    const result = extractResponseFromJSON('{"response": "Updated parser, all tests pass"}');
    expect(result).toBe("Updated parser, all tests pass");
  });

  it("returns null for invalid JSON", () => {
    const result = extractResponseFromJSON("not json");
    expect(result).toBeNull();
  });

  it("returns null for JSON without response key", () => {
    const result = extractResponseFromJSON('{"other": "value"}');
    expect(result).toBeNull();
  });

  it("handles markdown code fences around JSON", () => {
    const output = 'Some text\n```json\n{"response": "Fixed the bug"}\n```\nmore text';
    const result = extractResponseFromJSON(output);
    expect(result).toBe("Fixed the bug");
  });

  it("handles code fences without language tag", () => {
    const output = '```\n{"response": "done"}\n```';
    const result = extractResponseFromJSON(output);
    expect(result).toBe("done");
  });

  it("handles whitespace around JSON", () => {
    const result = extractResponseFromJSON('  {"response": "  spaced  "}  ');
    expect(result).toBe("spaced");
  });

  it("returns null for empty response value", () => {
    const result = extractResponseFromJSON('{"response": ""}');
    expect(result).toBeNull();
  });

  it("returns null for null input", () => {
    const result = extractResponseFromJSON("");
    expect(result).toBeNull();
  });
});

describe("extractLastBlock", () => {
  it("returns the last non-empty block", () => {
    const result = extractLastBlock("first block\n\nsecond block\n\nfinal summary");
    expect(result).toBe("final summary");
  });

  it("handles single block", () => {
    const result = extractLastBlock("just one block");
    expect(result).toBe("just one block");
  });

  it("handles empty input", () => {
    const result = extractLastBlock("");
    expect(result).toBe("");
  });

  it("trims whitespace from blocks", () => {
    const result = extractLastBlock("a\n\n  b  \n\n  c  ");
    expect(result).toBe("c");
  });
});
