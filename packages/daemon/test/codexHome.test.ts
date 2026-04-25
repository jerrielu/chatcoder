import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ensureCodexHome,
  renderCodexAuthJson,
  renderCodexConfigToml,
  codexHomeFor,
  setCodexRootOverride,
  DEFAULT_CODEX_BASE_URL
} from "../src/codexHome.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-codex-"));
  setCodexRootOverride(tmpRoot);
});
afterEach(() => {
  setCodexRootOverride(null);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("renderCodexConfigToml", () => {
  it("uses the default base URL when none supplied", () => {
    const toml = renderCodexConfigToml({
      apiKey: "sk",
      fullAuto: false,
      extraArgs: []
    });
    expect(toml).toContain(`base_url = "${DEFAULT_CODEX_BASE_URL}"`);
    expect(toml).toContain(`model_provider = "OpenAI"`);
    expect(toml).toContain(`wire_api = "responses"`);
  });

  it("escapes quotes + backslashes in base_url", () => {
    const toml = renderCodexConfigToml({
      apiKey: "sk",
      baseUrl: "https://custom\\host/\"evil\"",
      fullAuto: false,
      extraArgs: []
    });
    expect(toml).toContain('base_url = "https://custom\\\\host/\\"evil\\""');
  });
});

describe("renderCodexAuthJson", () => {
  it("embeds apikey auth_mode", () => {
    const json = renderCodexAuthJson({
      apiKey: "sk-x",
      fullAuto: false,
      extraArgs: []
    });
    const parsed = JSON.parse(json);
    expect(parsed.auth_mode).toBe("apikey");
    expect(parsed.OPENAI_API_KEY).toBe("sk-x");
  });
});

describe("ensureCodexHome", () => {
  it("writes config.toml + auth.json and marks it idempotent", () => {
    const first = ensureCodexHome("prof-a", {
      apiKey: "sk-1",
      fullAuto: false,
      extraArgs: []
    });
    expect(first.changed).toBe(true);
    expect(first.codexHome).toBe(codexHomeFor("prof-a"));
    expect(first.codexHome.startsWith(tmpRoot)).toBe(true);
    expect(fs.existsSync(path.join(first.codexHome, "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(first.codexHome, "auth.json"))).toBe(true);

    const second = ensureCodexHome("prof-a", {
      apiKey: "sk-1",
      fullAuto: false,
      extraArgs: []
    });
    expect(second.changed).toBe(false);
  });

  it("rewrites when baseUrl changes", () => {
    const a = ensureCodexHome("prof-b", {
      apiKey: "k",
      baseUrl: "https://a.example.com",
      fullAuto: false,
      extraArgs: []
    });
    expect(a.changed).toBe(true);
    const b = ensureCodexHome("prof-b", {
      apiKey: "k",
      baseUrl: "https://b.example.com",
      fullAuto: false,
      extraArgs: []
    });
    expect(b.changed).toBe(true);
    const toml = fs.readFileSync(path.join(b.codexHome, "config.toml"), "utf8");
    expect(toml).toContain("b.example.com");
  });

  it("isolates profiles into different directories", () => {
    const a = ensureCodexHome("one", { apiKey: "1", fullAuto: false, extraArgs: [] });
    const b = ensureCodexHome("two", { apiKey: "2", fullAuto: false, extraArgs: [] });
    expect(a.codexHome).not.toBe(b.codexHome);
    const aAuth = JSON.parse(fs.readFileSync(path.join(a.codexHome, "auth.json"), "utf8"));
    const bAuth = JSON.parse(fs.readFileSync(path.join(b.codexHome, "auth.json"), "utf8"));
    expect(aAuth.OPENAI_API_KEY).toBe("1");
    expect(bAuth.OPENAI_API_KEY).toBe("2");
  });
});
