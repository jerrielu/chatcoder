import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DaemonConfig, loadConfig, writeConfig, defaultConfigPath } from "../src/config.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-daemon-"));
}

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiUrl: "https://x.example.com",
    apiKey: "sufficiently-long-key-yes",
    profiles: [
      {
        tool: "CLAUDE_CODE",
        name: "main",
        claudeCode: { authToken: "sk-ant-test" }
      }
    ],
    ...overrides
  };
}

describe("DaemonConfig", () => {
  it("fills defaults", () => {
    const cfg = DaemonConfig.parse(baseInput());
    expect(cfg.pollIntervalMs).toBe(2000);
    expect(cfg.idleShutdownMs).toBe(3_600_000);
    expect(cfg.maxConcurrency).toBe(4);
    expect(cfg.profiles[0]!.tool).toBe("CLAUDE_CODE");
  });

  it("rejects a too-short key", () => {
    expect(() => DaemonConfig.parse(baseInput({ apiKey: "short" }))).toThrow();
  });

  it("requires at least one profile", () => {
    expect(() => DaemonConfig.parse(baseInput({ profiles: [] }))).toThrow();
  });

  it("writes and loads round-trip", () => {
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const cfg = DaemonConfig.parse(baseInput());
    writeConfig(cfg, p);
    const loaded = loadConfig(p);
    expect(loaded.apiKey).toBe(cfg.apiKey);
    expect(loaded.idleShutdownMs).toBe(cfg.idleShutdownMs);
    expect(loaded.profiles[0]!.name).toBe("main");
    const stat = fs.statSync(p);
    expect(stat.mode & 0o077).toBe(0);
  });

  it("defaultConfigPath is under home", () => {
    const p = defaultConfigPath();
    expect(p.startsWith(os.homedir())).toBe(true);
  });

  it("parses all three tool variants", () => {
    const cfg = DaemonConfig.parse(
      baseInput({
        profiles: [
          {
            tool: "CLAUDE_CODE",
            name: "cc",
            claudeCode: { authToken: "k" }
          },
          {
            tool: "OPENAI",
            name: "ox",
            codex: { apiKey: "k", fullAuto: true }
          },
          {
            tool: "CUSTOM",
            name: "cu",
            custom: { launchBin: "/bin/echo" }
          }
        ]
      })
    );
    expect(cfg.profiles.map((p) => p.tool)).toEqual([
      "CLAUDE_CODE",
      "OPENAI",
      "CUSTOM"
    ]);
  });
});
