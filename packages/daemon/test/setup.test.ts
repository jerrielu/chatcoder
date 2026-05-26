import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runSetup, validators } from "../src/setup.js";
import { setCodexRootOverride, setSourceCodexHomeOverride } from "../src/codexHome.js";

describe("setup validators", () => {
  it("apiUrl accepts http(s) and rejects others", () => {
    expect(validators.apiUrl("https://x.example.com")).toBe(true);
    expect(validators.apiUrl("http://localhost")).toBe(true);
    expect(typeof validators.apiUrl("ftp://x")).toBe("string");
    expect(typeof validators.apiUrl("")).toBe("string");
  });
  it("apiKey accepts ≥16 chars", () => {
    expect(validators.apiKey("x".repeat(16))).toBe(true);
    expect(typeof validators.apiKey("short")).toBe("string");
  });
  it("profileName only allows slug-like values", () => {
    expect(validators.profileName("main")).toBe(true);
    expect(validators.profileName("feat-a.1")).toBe(true);
    expect(typeof validators.profileName("has spaces")).toBe("string");
    expect(typeof validators.profileName("")).toBe("string");
  });
});

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-setup-"));
}

let codexRoot: string;
let sourceRoot: string;

beforeEach(() => {
  codexRoot = tmp();
  sourceRoot = tmp();
  setCodexRootOverride(codexRoot);
  setSourceCodexHomeOverride(sourceRoot);
});

afterEach(() => {
  setCodexRootOverride(null);
  setSourceCodexHomeOverride(null);
  fs.rmSync(codexRoot, { recursive: true, force: true });
  fs.rmSync(sourceRoot, { recursive: true, force: true });
});

/**
 * The walkthrough calls `prompt` several times: top-level (apiUrl + keyMode),
 * profile-action menu, per-profile (name, tool, metadata), the per-tool
 * prompts, and finally a concurrency number. `scriptedPrompt` serves answers
 * from a queue, letting tests drive the wizard deterministically.
 */
function scriptedPrompt(
  answers: Array<Record<string, unknown>>
): Parameters<typeof runSetup>[1] {
  let i = 0;
  const prompt = (async () => answers[i++] ?? {}) as unknown as Parameters<typeof runSetup>[1] extends
    infer IO
    ? IO extends { prompt: infer P }
      ? P
      : never
    : never;
  return { prompt: prompt as never, log: () => void 0 };
}

describe("runSetup", () => {
  it("writes a valid CLAUDE_CODE profile from answers", async () => {
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const written = await runSetup(
      undefined,
      scriptedPrompt([
        { apiUrl: "https://bot.example.com", keyMode: "existing" },
        { apiKey: "long-enough-api-key-abcdef" },
        { action: "add" },
        {
          name: "main",
          tool: "CLAUDE_CODE",
          metadata: ""
        },
        { editAuthentication: true },
        {
          authToken: "sk-ant-x",
          baseUrl: ""
        },
        {
          model: "",
          skipPermissions: true,
          outputFormat: "text"
        },
        { action: "continue" },
        { maxConcurrency: 4 }
      ]),
      p
    );
    expect(written).toBe(p);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("can create a Codex profile without editing auth", async () => {
    fs.writeFileSync(path.join(sourceRoot, "config.toml"), "model_provider = \"Host\"\n");
    fs.writeFileSync(
      path.join(sourceRoot, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "from-host" }, null, 2) + "\n"
    );
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const written = await runSetup(
      undefined,
      scriptedPrompt([
        { apiUrl: "https://bot.example.com", keyMode: "existing" },
        { apiKey: "long-enough-api-key-abcdef" },
        { action: "add" },
        {
          name: "codex-main",
          tool: "OPENAI",
          metadata: ""
        },
        { editAuthentication: false },
        {
          model: "",
          fullAuto: true,
          bypassApprovalsAndSandbox: true
        },
        { action: "continue" },
        { maxConcurrency: 4 }
      ]),
      p
    );
    expect(written).toBe(p);
    const body = fs.readFileSync(p, "utf8");
    expect(body).toContain("tool: OPENAI");
    expect(body).toContain("bypassApprovalsAndSandbox: true");
    expect(body).not.toContain("      apiKey:");
    const codexHome = path.join(codexRoot, "codex-main");
    expect(fs.readFileSync(path.join(codexHome, "config.toml"), "utf8")).toBe(
      "model_provider = \"Host\"\n"
    );
    const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));
    expect(auth.OPENAI_API_KEY).toBe("from-host");
  });

  it("aborts if the user skips the apiUrl", async () => {
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const written = await runSetup(
      undefined,
      scriptedPrompt([{ apiUrl: "", keyMode: "generate" }]),
      p
    );
    expect(written).toBeNull();
    expect(fs.existsSync(p)).toBe(false);
  });
});
