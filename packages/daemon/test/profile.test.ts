import { describe, it, expect } from "vitest";
import { Profile } from "../src/profile.js";

describe("Profile zod schema", () => {
  it("parses a CLAUDE_CODE profile with defaults", () => {
    const p = Profile.parse({
      name: "main",
      tool: "CLAUDE_CODE",
      claudeCode: { authToken: "sk-ant-x" }
    });
    expect(p.tool).toBe("CLAUDE_CODE");
    if (p.tool === "CLAUDE_CODE") {
      expect(p.claudeCode.authToken).toBe("sk-ant-x");
      expect(p.claudeCode.skipPermissions).toBe(false);
      expect(p.claudeCode.outputFormat).toBe("text");
      expect(p.claudeCode.extraArgs).toEqual([]);
    }
  });

  it("parses an OPENAI profile", () => {
    const p = Profile.parse({
      name: "ops",
      tool: "OPENAI",
      codex: { apiKey: "sk", fullAuto: true }
    });
    expect(p.tool).toBe("OPENAI");
    if (p.tool === "OPENAI") {
      expect(p.codex.fullAuto).toBe(true);
      expect(p.codex.bypassApprovalsAndSandbox).toBe(false);
    }
  });

  it("parses Codex profiles without explicit auth", () => {
    const codex = Profile.parse({
      name: "codex-host-auth",
      tool: "OPENAI",
      codex: {}
    });
    expect(codex.tool).toBe("OPENAI");
  });

  it("parses a CUSTOM profile with defaults", () => {
    const p = Profile.parse({
      name: "cu",
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
          tool: "CLAUDE_CODE",
        claudeCode: { authToken: "k" }
      })
    ).toThrow();
  });

  it("rejects CUSTOM without launchBin", () => {
    expect(() =>
      Profile.parse({
        name: "x",
          tool: "CUSTOM",
        custom: { args: [] }
      })
    ).toThrow();
  });

  it("rejects CUSTOM env keys with invalid chars", () => {
    expect(() =>
      Profile.parse({
        name: "x",
          tool: "CUSTOM",
        custom: { launchBin: "/bin/true", env: { "bad key": "x" } }
      })
    ).toThrow();
  });

  it("rejects unknown tool", () => {
    expect(() =>
      Profile.parse({
        name: "x",
          tool: "SOMETHING",
        claudeCode: { authToken: "k" }
      })
    ).toThrow();
  });
});
