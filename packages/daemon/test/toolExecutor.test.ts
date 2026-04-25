import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildLaunch } from "../src/toolExecutor.js";
import { setCodexRootOverride } from "../src/codexHome.js";
import type { Profile } from "../src/profile.js";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cc-toolexec-"));
  setCodexRootOverride(tmpRoot);
});
afterEach(() => {
  setCodexRootOverride(null);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("buildLaunch", () => {
  it("assembles Claude Code flags with skipPermissions and model", () => {
    const profile: Profile = {
      name: "main",
      cwd: "/repo",
      tool: "CLAUDE_CODE",
      claudeCode: {
        apiKey: "sk-ant",
        baseUrl: "https://custom.example.com",
        model: "claude-opus-4-7",
        skipPermissions: true,
        outputFormat: "stream-json",
        extraArgs: ["--append-system-prompt", "hello"]
      }
    };
    const launch = buildLaunch(profile, "refactor foo");
    expect(launch.cmd).toBe("claude");
    expect(launch.args).toEqual([
      "--print",
      "-c",
      "--model",
      "claude-opus-4-7",
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--append-system-prompt",
      "hello",
      "refactor foo"
    ]);
    expect(launch.env["ANTHROPIC_API_KEY"]).toBe("sk-ant");
    expect(launch.env["ANTHROPIC_BASE_URL"]).toBe("https://custom.example.com");
    expect(launch.cwd).toBe("/repo");
    expect(launch.stdinText).toBeNull();
  });

  it("does not set skipPermissions flag when false", () => {
    const profile: Profile = {
      name: "p",
      cwd: "/tmp",
      tool: "CLAUDE_CODE",
      claudeCode: { apiKey: "k", skipPermissions: false, outputFormat: "text", extraArgs: [] }
    };
    const launch = buildLaunch(profile, "m");
    expect(launch.args).not.toContain("--dangerously-skip-permissions");
  });

  it("does not inject Claude auth env when profile auth is omitted", () => {
    const profile: Profile = {
      name: "p",
      cwd: "/tmp",
      tool: "CLAUDE_CODE",
      claudeCode: { skipPermissions: false, outputFormat: "text", extraArgs: [] }
    };
    const launch = buildLaunch(profile, "m");
    expect(launch.env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(launch.env["ANTHROPIC_BASE_URL"]).toBeUndefined();
  });

  it("omits Claude resume flag when resumeLastSession is false", () => {
    const profile: Profile = {
      name: "p",
      cwd: "/tmp",
      tool: "CLAUDE_CODE",
      claudeCode: { apiKey: "k", skipPermissions: false, outputFormat: "text", extraArgs: [] }
    };
    const launch = buildLaunch(profile, "m", false);
    expect(launch.args).toEqual(["--print", "m"]);
  });

  it("uses codex exec and sets CODEX_HOME when launching OPENAI profile", () => {
    const profile: Profile = {
      name: "opx",
      cwd: "/tmp",
      tool: "OPENAI",
      codex: {
        apiKey: "sk",
        baseUrl: "https://api.example.com/v1",
        fullAuto: true,
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "ping");
    expect(launch.cmd).toBe("codex");
    expect(launch.args).toEqual(["exec", "resume", "--last", "--full-auto", "ping"]);
    expect(launch.env["CODEX_HOME"]).toMatch(/\/opx$/);
    expect(launch.env["OPENAI_API_KEY"]).toBe("sk");
    expect(launch.env["OPENAI_BASE_URL"]).toBe("https://api.example.com/v1");
  });

  it("does not inject OpenAI auth env when profile auth is omitted", () => {
    const profile: Profile = {
      name: "opx-no-auth",
      cwd: "/tmp",
      tool: "OPENAI",
      codex: {
        fullAuto: true,
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "ping");
    expect(launch.env["CODEX_HOME"]).toBeUndefined();
    expect(launch.env["OPENAI_API_KEY"]).toBeUndefined();
    expect(launch.env["OPENAI_BASE_URL"]).toBeUndefined();
  });

  it("codex without fullAuto uses sandbox + approval flags", () => {
    const profile: Profile = {
      name: "o2",
      cwd: "/tmp",
      tool: "OPENAI",
      codex: {
        apiKey: "k",
        fullAuto: false,
        sandboxMode: "workspace-write",
        approvalMode: "on-failure",
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "go");
    expect(launch.args).toEqual([
      "exec",
      "resume",
      "--last",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "on-failure",
      "go"
    ]);
  });

  it("Codex bypass flag takes precedence over other execution policy flags", () => {
    const profile: Profile = {
      name: "o2-bypass",
      cwd: "/tmp",
      tool: "OPENAI",
      codex: {
        apiKey: "k",
        fullAuto: true,
        bypassApprovalsAndSandbox: true,
        sandboxMode: "workspace-write",
        approvalMode: "on-failure",
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "go");
    expect(launch.args).toEqual([
      "exec",
      "resume",
      "--last",
      "--dangerously-bypass-approvals-and-sandbox",
      "go"
    ]);
  });

  it("omits Codex resume flag when resumeLastSession is false", () => {
    const profile: Profile = {
      name: "o3",
      cwd: "/tmp",
      tool: "OPENAI",
      codex: {
        apiKey: "k",
        fullAuto: true,
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "go", false);
    expect(launch.args).toEqual(["exec", "--full-auto", "go"]);
  });

  it("CUSTOM appended placement adds message as last arg", () => {
    const profile: Profile = {
      name: "c",
      cwd: "/tmp",
      tool: "CUSTOM",
      custom: {
        launchBin: "/bin/echo",
        args: ["--json"],
        env: { FOO: "bar" },
        messagePlacement: "appended"
      }
    };
    const launch = buildLaunch(profile, "hello");
    expect(launch.cmd).toBe("/bin/echo");
    expect(launch.args).toEqual(["--json", "hello"]);
    expect(launch.env["FOO"]).toBe("bar");
    expect(launch.stdinText).toBeNull();
  });

  it("CUSTOM stdin placement writes to stdin", () => {
    const profile: Profile = {
      name: "c",
      cwd: "/tmp",
      tool: "CUSTOM",
      custom: {
        launchBin: "/bin/cat",
        args: [],
        env: {},
        messagePlacement: "stdin"
      }
    };
    const launch = buildLaunch(profile, "payload");
    expect(launch.args).toEqual([]);
    expect(launch.stdinText).toBe("payload");
  });

  it("CUSTOM placeholder placement substitutes $message", () => {
    const profile: Profile = {
      name: "c",
      cwd: "/tmp",
      tool: "CUSTOM",
      custom: {
        launchBin: "bash",
        args: ["-c", "echo $message $message"],
        env: {},
        messagePlacement: "placeholder"
      }
    };
    const launch = buildLaunch(profile, "hi");
    expect(launch.args).toEqual(["-c", "echo hi hi"]);
  });
});
