import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runSetup, validators } from "../src/setup.js";

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
});

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cc-setup-"));
}

function fakePrompt(answers: Record<string, unknown>): Parameters<typeof runSetup>[1] {
  const fn = (async () => answers) as unknown as Parameters<typeof runSetup>[1] extends infer IO
    ? IO extends { prompt: infer P }
      ? P
      : never
    : never;
  return { prompt: fn as never, log: () => void 0 };
}

describe("runSetup", () => {
  it("writes a valid config from answers", async () => {
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const written = await runSetup(
      undefined,
      fakePrompt({
        apiUrl: "https://bot.example.com",
        apiKey: "long-enough-api-key-abcdef",
        command: "codex --message \"$message\"",
        cwd: "/tmp"
      }),
      p
    );
    expect(written).toBe(p);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("aborts if the user skips required fields", async () => {
    const dir = tmp();
    const p = path.join(dir, "config.yml");
    const written = await runSetup(
      undefined,
      fakePrompt({ apiUrl: "", apiKey: "" }),
      p
    );
    expect(written).toBeNull();
    expect(fs.existsSync(p)).toBe(false);
  });
});
