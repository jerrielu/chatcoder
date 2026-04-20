import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DaemonConfig, loadConfig, writeConfig, defaultConfigPath } from "../src/config.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-daemon-"));
}

describe("DaemonConfig", () => {
  it("fills defaults", () => {
    const cfg = DaemonConfig.parse({
      apiUrl: "https://x.example.com",
      apiKey: "sufficiently-long-key-yes"
    });
    expect(cfg.pollIntervalMs).toBe(2000);
    expect(cfg.idleShutdownMs).toBe(3_600_000);
    expect(cfg.command).toBe('codex --message "$message"');
  });

  it("rejects a too-short key", () => {
    expect(() =>
      DaemonConfig.parse({ apiUrl: "https://x.example.com", apiKey: "short" })
    ).toThrow();
  });

  it("writes and loads round-trip", () => {
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const cfg = DaemonConfig.parse({
      apiUrl: "https://x.example.com",
      apiKey: "sufficiently-long-key-yes"
    });
    writeConfig(cfg, p);
    const loaded = loadConfig(p);
    expect(loaded.apiKey).toBe(cfg.apiKey);
    expect(loaded.idleShutdownMs).toBe(cfg.idleShutdownMs);
    const stat = fs.statSync(p);
    // file should be owner-readable, no world bits
    expect(stat.mode & 0o077).toBe(0);
  });

  it("defaultConfigPath is under home", () => {
    const p = defaultConfigPath();
    expect(p.startsWith(os.homedir())).toBe(true);
  });
});
