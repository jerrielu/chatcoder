import { describe, it, expect } from "vitest";
import { extractSummaryFromJSON, extractLastBlock } from "../src/summary.js";

describe("extractSummaryFromJSON", () => {
  it("extracts summary from plain JSON", () => {
    const result = extractSummaryFromJSON('{"summary": "Updated parser, all tests pass"}');
    expect(result).toBe("Updated parser, all tests pass");
  });

  it("returns null for invalid JSON", () => {
    const result = extractSummaryFromJSON("not json");
    expect(result).toBeNull();
  });

  it("returns null for JSON without summary key", () => {
    const result = extractSummaryFromJSON('{"other": "value"}');
    expect(result).toBeNull();
  });

  it("handles markdown code fences around JSON", () => {
    const output = 'Some text\n```json\n{"summary": "Fixed the bug"}\n```\nmore text';
    const result = extractSummaryFromJSON(output);
    expect(result).toBe("Fixed the bug");
  });

  it("handles code fences without language tag", () => {
    const output = '```\n{"summary": "done"}\n```';
    const result = extractSummaryFromJSON(output);
    expect(result).toBe("done");
  });

  it("handles whitespace around JSON", () => {
    const result = extractSummaryFromJSON('  {"summary": "  spaced  "}  ');
    expect(result).toBe("spaced");
  });

  it("returns null for empty summary value", () => {
    const result = extractSummaryFromJSON('{"summary": ""}');
    expect(result).toBeNull();
  });

  it("returns null for null input", () => {
    const result = extractSummaryFromJSON("");
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
