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
  setSourceCodexHomeOverride,
  DEFAULT_CODEX_BASE_URL
} from "../src/codexHome.js";

let tmpRoot: string;
let sourceRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-codex-"));
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-codex-source-"));
  setCodexRootOverride(tmpRoot);
  setSourceCodexHomeOverride(sourceRoot);
});
afterEach(() => {
  setCodexRootOverride(null);
  setSourceCodexHomeOverride(null);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(sourceRoot, { recursive: true, force: true });
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

  it("rejects auth rendering without an API key", () => {
    expect(() => renderCodexAuthJson({ fullAuto: false, extraArgs: [] })).toThrow(
      /without an API key/
    );
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

  it("copies host ~/.codex config/auth when profile auth is omitted", () => {
    fs.writeFileSync(path.join(sourceRoot, "config.toml"), "model_provider = \"Host\"\n");
    fs.writeFileSync(
      path.join(sourceRoot, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "from-host" }, null, 2) + "\n"
    );

    const first = ensureCodexHome("host-copy", {
      fullAuto: false,
      extraArgs: []
    });
    expect(first.changed).toBe(true);
    expect(fs.readFileSync(path.join(first.codexHome, "config.toml"), "utf8")).toBe(
      "model_provider = \"Host\"\n"
    );
    const auth = JSON.parse(fs.readFileSync(path.join(first.codexHome, "auth.json"), "utf8"));
    expect(auth.OPENAI_API_KEY).toBe("from-host");
  });

  it("keeps scoped profile config/auth stable after first copy", () => {
    fs.writeFileSync(path.join(sourceRoot, "config.toml"), "model_provider = \"Host-A\"\n");
    fs.writeFileSync(
      path.join(sourceRoot, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "host-a" }, null, 2) + "\n"
    );

    const first = ensureCodexHome("sticky", {
      fullAuto: false,
      extraArgs: []
    });
    expect(first.changed).toBe(true);

    fs.writeFileSync(path.join(sourceRoot, "config.toml"), "model_provider = \"Host-B\"\n");
    fs.writeFileSync(
      path.join(sourceRoot, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "host-b" }, null, 2) + "\n"
    );

    const second = ensureCodexHome("sticky", {
      fullAuto: false,
      extraArgs: []
    });
    expect(second.changed).toBe(false);
    expect(fs.readFileSync(path.join(second.codexHome, "config.toml"), "utf8")).toBe(
      "model_provider = \"Host-A\"\n"
    );
    const auth = JSON.parse(fs.readFileSync(path.join(second.codexHome, "auth.json"), "utf8"));
    expect(auth.OPENAI_API_KEY).toBe("host-a");
  });

  it("explicit apiKey/baseUrl overrides host ~/.codex values", () => {
    fs.writeFileSync(path.join(sourceRoot, "config.toml"), "model_provider = \"Host\"\n");
    fs.writeFileSync(
      path.join(sourceRoot, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "from-host" }, null, 2) + "\n"
    );

    const out = ensureCodexHome("explicit", {
      apiKey: "from-profile",
      baseUrl: "https://profile.example.com",
      fullAuto: false,
      extraArgs: []
    });
    const toml = fs.readFileSync(path.join(out.codexHome, "config.toml"), "utf8");
    const auth = JSON.parse(fs.readFileSync(path.join(out.codexHome, "auth.json"), "utf8"));
    expect(toml).toContain("profile.example.com");
    expect(auth.OPENAI_API_KEY).toBe("from-profile");
  });
});
