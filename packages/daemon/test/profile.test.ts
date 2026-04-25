import { describe, it, expect } from "vitest";
import { Profile } from "../src/profile.js";

describe("Profile zod schema", () => {
  it("parses a CLAUDE_CODE profile with defaults", () => {
    const p = Profile.parse({
      name: "main",
      cwd: "/tmp",
      tool: "CLAUDE_CODE",
      claudeCode: { apiKey: "sk-ant-x" }
    });
    expect(p.tool).toBe("CLAUDE_CODE");
    if (p.tool === "CLAUDE_CODE") {
      expect(p.claudeCode.skipPermissions).toBe(false);
      expect(p.claudeCode.outputFormat).toBe("text");
      expect(p.claudeCode.extraArgs).toEqual([]);
    }
  });

  it("parses an OPENAI profile", () => {
    const p = Profile.parse({
      name: "ops",
      cwd: "/tmp",
      tool: "OPENAI",
      codex: { apiKey: "sk", fullAuto: true }
    });
    expect(p.tool).toBe("OPENAI");
    if (p.tool === "OPENAI") {
      expect(p.codex.fullAuto).toBe(true);
    }
  });

  it("parses a CUSTOM profile with defaults", () => {
    const p = Profile.parse({
      name: "cu",
      cwd: "/tmp",
      tool: "CUSTOM",
      custom: { launchBin: "/bin/echo" }
    });
    if (p.tool === "CUSTOM") {
      expect(p.custom.launchBin).toBe("/bin/echo");
      expect(p.custom.args).toEqual([]);
      expect(p.custom.env).toEqual({});
      expect(p.custom.messagePlacement).toBe("appended");
    }
  });

  it("rejects slug-hostile profile names", () => {
    expect(() =>
      Profile.parse({
        name: "has space",
        cwd: "/tmp",
        tool: "CLAUDE_CODE",
        claudeCode: { apiKey: "k" }
      })
    ).toThrow();
  });

  it("rejects CUSTOM without launchBin", () => {
    expect(() =>
      Profile.parse({
        name: "x",
        cwd: "/tmp",
        tool: "CUSTOM",
        custom: { args: [] }
      })
    ).toThrow();
  });

  it("rejects CUSTOM env keys with invalid chars", () => {
    expect(() =>
      Profile.parse({
        name: "x",
        cwd: "/tmp",
        tool: "CUSTOM",
        custom: { launchBin: "/bin/true", env: { "bad key": "x" } }
      })
    ).toThrow();
  });

  it("rejects unknown tool", () => {
    expect(() =>
      Profile.parse({
        name: "x",
        cwd: "/tmp",
        tool: "SOMETHING",
        claudeCode: { apiKey: "k" }
      })
    ).toThrow();
  });
});
