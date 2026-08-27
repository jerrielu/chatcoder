import { describe, it, expect } from "vitest";
import {
  buildAutoProfiles,
  parseModelListOutput,
  sanitizeModelName
} from "../src/commandCodeModels.js";
import type { Profile } from "../src/profile.js";

describe("sanitizeModelName", () => {
  it("keeps already-slug-safe model ids unchanged", () => {
    expect(sanitizeModelName("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(sanitizeModelName("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("replaces slash with underscore for provider-qualified ids", () => {
    expect(sanitizeModelName("Qwen/Qwen3.8-Max")).toBe("Qwen_Qwen3.8-Max");
    expect(sanitizeModelName("deepseek/deepseek-v4-flash")).toBe(
      "deepseek_deepseek-v4-flash"
    );
  });

  it("replaces any other non-slug character", () => {
    expect(sanitizeModelName("model id")).toBe("model_id");
    expect(sanitizeModelName("a:b*c")).toBe("a_b_c");
  });

  it("trims surrounding whitespace first", () => {
    expect(sanitizeModelName("  gpt-x  ")).toBe("gpt-x");
  });
});

describe("buildAutoProfiles", () => {
  it("creates one COMMAND_CODE profile per model named cmd+<sanitized>", () => {
    const profiles: Profile[] = buildAutoProfiles([
      "gpt-5.6-terra",
      "Qwen/Qwen3.8-Max"
    ]);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      name: "cmd+gpt-5.6-terra",
      tool: "COMMAND_CODE",
      commandCode: { model: "gpt-5.6-terra" }
    });
    expect(profiles[1]!.name).toBe("cmd+Qwen_Qwen3.8-Max");
  });

  it("carries the raw (unsanitized) model id in commandCode.model", () => {
    const profiles = buildAutoProfiles(["Qwen/Qwen3.8-Max"]);
    if (profiles[0]?.tool !== "COMMAND_CODE") throw new Error("wrong tool kind");
    expect(profiles[0].commandCode.model).toBe("Qwen/Qwen3.8-Max");
  });

  it("deduplicates by sanitized profile name and skips blanks", () => {
    const profiles = buildAutoProfiles([
      "dup/model",
      "dup_model",
      "",
      "   "
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe("cmd+dup_model");
  });
});

describe("parseModelListOutput", () => {
  it("extracts one model id per line", () => {
    const out = [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "claude-sonnet-5"
    ].join("\n");
    expect(parseModelListOutput(out)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "claude-sonnet-5"
    ]);
  });

  it("handles table rows with extra columns and decoration", () => {
    const out = [
      "| Id (use EXACTLY this) | Name | Context |",
      "|---|---|---|",
      "`gpt-5.6-luna`  GPT-5.6 Luna  1.05M",
      "* claude-opus-5  Claude Opus 5  1M"
    ].join("\n");
    const models = parseModelListOutput(out);
    expect(models).toContain("gpt-5.6-luna");
    expect(models).toContain("claude-opus-5");
    // Decoration tokens are not mistaken for models.
    expect(models).not.toContain("|");
    expect(models).not.toContain("---|---|---");
  });

  it("returns provider-qualified ids intact", () => {
    expect(parseModelListOutput("Qwen/Qwen3.8-Max")).toEqual(["Qwen/Qwen3.8-Max"]);
  });

  it("ignores prose words from help output", () => {
    expect(parseModelListOutput("the and for with model models name id")).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(parseModelListOutput("")).toEqual([]);
  });
});
