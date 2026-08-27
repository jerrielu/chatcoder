import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildLaunch, ToolExecutor } from "../src/toolExecutor.js";
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
      tool: "CLAUDE_CODE",
      claudeCode: {
        authToken: "sk-ant",
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
    expect(launch.env["ANTHROPIC_AUTH_TOKEN"]).toBe("sk-ant");
    expect(launch.env["ANTHROPIC_BASE_URL"]).toBe("https://custom.example.com");
    expect(launch.cwd).toBe(process.cwd());
    expect(launch.stdinText).toBeNull();
  });

  it("does not set skipPermissions flag when false", () => {
    const profile: Profile = {
      name: "p",
      tool: "CLAUDE_CODE",
      claudeCode: { authToken: "k", skipPermissions: false, outputFormat: "text", extraArgs: [] }
    };
    const launch = buildLaunch(profile, "m");
    expect(launch.args).not.toContain("--dangerously-skip-permissions");
  });

  it("does not inject Claude auth env when profile auth is omitted", () => {
    const profile: Profile = {
      name: "p",
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
      tool: "CLAUDE_CODE",
      claudeCode: { authToken: "k", skipPermissions: false, outputFormat: "text", extraArgs: [] }
    };
    const launch = buildLaunch(profile, "m", false);
    expect(launch.args).toEqual(["--print", "m"]);
  });

  it("uses codex exec and sets CODEX_HOME when launching OPENAI profile", () => {
    const profile: Profile = {
      name: "opx",
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
    expect(launch.args).toEqual([
      "exec",
      "resume",
      "--last",
      "--full-auto",
      "-o",
      expect.stringMatching(/chatcoder-codex-final-opx-/),
      "ping"
    ]);
    expect(launch.env["CODEX_HOME"]).toMatch(/\/opx$/);
    expect(launch.env["OPENAI_API_KEY"]).toBe("sk");
    expect(launch.env["OPENAI_BASE_URL"]).toBe("https://api.example.com/v1");
  });

  it("uses scoped CODEX_HOME even when OpenAI profile auth is omitted", () => {
    const profile: Profile = {
      name: "opx-no-auth",
      tool: "OPENAI",
      codex: {
        fullAuto: true,
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "ping");
    expect(launch.env["CODEX_HOME"]).toMatch(/\/opx-no-auth$/);
    expect(fs.existsSync(path.join(String(launch.env["CODEX_HOME"]), "config.toml"))).toBe(true);
    expect(launch.env["OPENAI_API_KEY"]).toBeUndefined();
    expect(launch.env["OPENAI_BASE_URL"]).toBeUndefined();
  });

  it("codex without fullAuto uses sandbox + approval flags", () => {
    const profile: Profile = {
      name: "o2",
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
      "-o",
      expect.stringMatching(/chatcoder-codex-final-o2-/),
      "go"
    ]);
  });

  it("Codex bypass flag takes precedence over other execution policy flags", () => {
    const profile: Profile = {
      name: "o2-bypass",
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
      "-o",
      expect.stringMatching(/chatcoder-codex-final-o2-bypass-/),
      "go"
    ]);
  });

  it("omits Codex resume flag when resumeLastSession is false", () => {
    const profile: Profile = {
      name: "o3",
      tool: "OPENAI",
      codex: {
        apiKey: "k",
        fullAuto: true,
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "go", false);
    expect(launch.args).toEqual([
      "exec",
      "--full-auto",
      "-o",
      expect.stringMatching(/chatcoder-codex-final-o3-/),
      "go"
    ]);
  });

  it("applies Codex reasoning effort override when provided", () => {
    const profile: Profile = {
      name: "o4",
      tool: "OPENAI",
      codex: {
        apiKey: "k",
        fullAuto: true,
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "go", true, "xhigh");
    expect(launch.args).toEqual([
      "exec",
      "resume",
      "--last",
      "--full-auto",
      "-c",
      "model_reasoning_effort=xhigh",
      "-o",
      expect.stringMatching(/chatcoder-codex-final-o4-/),
      "go"
    ]);
  });

  it("runs reasonix with run subcommand and forced auto permission mode", () => {
    const profile: Profile = {
      name: "rx",
      tool: "REASONIX",
      reasonix: {
        model: "deepseek-flash/deepseek-v4-flash",
        extraArgs: ["--verbose"]
      }
    };
    const launch = buildLaunch(profile, "implement the TODO", true);
    expect(launch.cmd).toBe("reasonix");
    expect(launch.args).toEqual([
      "run",
      "-c",
      "--model",
      "deepseek-flash/deepseek-v4-flash",
      "--verbose",
      "--permission-mode",
      "auto",
      "implement the TODO"
    ]);
  });

  it("forces auto permission mode even when extraArgs try to override it", () => {
    const profile: Profile = {
      name: "rx2",
      tool: "REASONIX",
      reasonix: {
        model: "mimo-opencode-go/mimo-v2.5",
        extraArgs: ["--permission-mode", "manual"]
      }
    };
    const launch = buildLaunch(profile, "do the thing", false);
    expect(launch.args).toEqual([
      "run",
      "--model",
      "mimo-opencode-go/mimo-v2.5",
      "--permission-mode",
      "manual",
      "--permission-mode",
      "auto",
      "do the thing"
    ]);
  });

  it("runs cmd headless with yolo, model and effort preset", () => {
    const profile: Profile = {
      name: "cmd+gpt-5.6-terra",
      tool: "COMMAND_CODE",
      commandCode: {
        model: "gpt-5.6-terra",
        effort: "xhigh",
        extraArgs: []
      }
    };
    const launch = buildLaunch(profile, "fix the bug");
    expect(launch.cmd).toBe("cmd");
    expect(launch.args).toEqual([
      "-p",
      "--yolo",
      "-c",
      "--model",
      "gpt-5.6-terra",
      "--effort",
      "xhigh",
      "fix the bug"
    ]);
    expect(launch.stdinText).toBeNull();
  });

  it("per-instruction effort override wins over the profile preset for cmd", () => {
    const profile: Profile = {
      name: "cmd+gpt-5.6-terra",
      tool: "COMMAND_CODE",
      commandCode: {
        model: "gpt-5.6-terra",
        effort: "low",
        extraArgs: []
      }
    };
    const fresh = buildLaunch(profile, "go", false, "high");
    expect(fresh.args).toEqual([
      "-p",
      "--yolo",
      "--model",
      "gpt-5.6-terra",
      "--effort",
      "high",
      "go"
    ]);
  });

  it("omits cmd flags that are unset and passes extraArgs before the message", () => {
    const profile: Profile = {
      name: "cmd+bare",
      tool: "COMMAND_CODE",
      commandCode: {
        extraArgs: ["--max-turns", "50"]
      }
    };
    const launch = buildLaunch(profile, "hello");
    expect(launch.args).toEqual([
      "-p",
      "--yolo",
      "-c",
      "--max-turns",
      "50",
      "hello"
    ]);
  });

  it("CUSTOM appended placement adds message as last arg", () => {
    const profile: Profile = {
      name: "c",
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

describe("ToolExecutor", () => {
  it("contains onOutput callback errors and still resolves with tool output", async () => {
    const profile: Profile = {
      name: "custom-output",
      tool: "CUSTOM",
      custom: {
        launchBin: process.execPath,
        args: ["-e", "process.stdout.write('hello')"],
        env: {},
        messagePlacement: "stdin"
      }
    };
    const logs: Array<{ msg: string; extra?: unknown }> = [];
    const executor = new ToolExecutor({
      log: (msg, extra) => logs.push({ msg, extra })
    });

    const output = await executor.execute(profile, "go", {
      onOutput: () => {
        throw new Error("observer failed");
      }
    });

    expect(output).toBe("hello");
    expect(logs.some((entry) => entry.msg === "output callback failed")).toBe(true);
  });

  it("reports child spawn errors as rejected tool execution", async () => {
    const profile: Profile = {
      name: "custom-missing-bin",
      tool: "CUSTOM",
      custom: {
        launchBin: path.join(tmpRoot, "missing-tool"),
        args: [],
        env: {},
        messagePlacement: "stdin"
      }
    };
    const executor = new ToolExecutor();

    await expect(executor.execute(profile, "go")).rejects.toThrow();
  });

  it("returns only Codex last-message output when Codex writes one", async () => {
    const fakeBin = path.join(tmpRoot, "codex");
    fs.writeFileSync(
      fakeBin,
      [
        "#!/bin/sh",
        "out=''",
        "prev=''",
        "for arg in \"$@\"; do",
        "  if [ \"$prev\" = '-o' ]; then out=\"$arg\"; fi",
        "  prev=\"$arg\"",
        "done",
        "printf '%s' '- concise final response' > \"$out\"",
        "printf '%s\\n' 'OpenAI Codex noisy transcript'",
        "printf '%s\\n' 'tokens used 123'",
        ""
      ].join("\n"),
      { mode: 0o755 }
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${tmpRoot}${path.delimiter}${originalPath ?? ""}`;
    const profile: Profile = {
      name: "codex-final",
      tool: "OPENAI",
      codex: {
        fullAuto: true,
        extraArgs: []
      }
    };
    const executor = new ToolExecutor();

    try {
      const output = await executor.execute(profile, "go");

      expect(output).toBe("- concise final response");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("returns raw tool output from execute()", async () => {
    const profile: Profile = {
      name: "custom-summary",
      tool: "CUSTOM",
      custom: {
        launchBin: process.execPath,
        args: ["-e", `process.stdout.write(JSON.stringify({ response: "done" }))`],
        env: {},
        messagePlacement: "stdin"
      }
    };
    const executor = new ToolExecutor();
    const output = await executor.execute(profile, "go");
    expect(output).toBe('{"response":"done"}');
  });

  it("kills a silent child and rejects after the stall timeout", async () => {
    const profile: Profile = {
      name: "custom-slow",
      tool: "CUSTOM",
      custom: {
        launchBin: process.execPath,
        args: ["-e", "process.stdout.write('hello'); setInterval(() => {}, 1000)"],
        env: {},
        messagePlacement: "stdin"
      }
    };
    const logs: Array<{ msg: string; extra?: unknown }> = [];
    const executor = new ToolExecutor({
      log: (msg, extra) => logs.push({ msg, extra }),
      stallTimeoutMs: 200,
      stallRetries: 0
    });

    await expect(executor.execute(profile, "go")).rejects.toThrow(/stalled/i);
    expect(logs.some((entry) => entry.msg === "tool execution stalled — killing process")).toBe(true);
    expect(logs.some((entry) => entry.msg.includes("relaunching the same task"))).toBe(false);
  });

  it("kills a stalled run and relaunches the same task, resolving with the relaunched output", async () => {
    const counterFile = path.join(tmpRoot, "stall-once-counter");
    const profile: Profile = {
      name: "custom-stall-once",
      tool: "CUSTOM",
      custom: {
        launchBin: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('fs');",
            "const file = process.env.COUNTER_FILE;",
            "let n = 0;",
            "try { n = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch {}",
            "n++;",
            "fs.writeFileSync(file, String(n));",
            "if (n === 1) {",
            "  process.stdout.write('first run started\\n');",
            "  setInterval(() => {}, 1000);", // stall — killed by the watchdog
            "} else {",
            "  process.stdout.write('second run done\\n');",
            "  process.exit(0);",
            "}"
          ].join("")
        ],
        env: { COUNTER_FILE: counterFile },
        messagePlacement: "stdin"
      }
    };
    const logs: Array<{ msg: string; extra?: unknown }> = [];
    const executor = new ToolExecutor({
      log: (msg, extra) => logs.push({ msg, extra }),
      stallTimeoutMs: 200,
      stallRetries: 2
    });

    const output = await executor.execute(profile, "go");
    expect(output).toContain("second run done");
    expect(fs.readFileSync(counterFile, "utf8").trim()).toBe("2");
    expect(logs.some((entry) => entry.msg.includes("relaunching the same task"))).toBe(true);
  });

  it("stops relaunching after stallRetries and rejects with the stall error", async () => {
    const counterFile = path.join(tmpRoot, "always-stall-counter");
    const profile: Profile = {
      name: "custom-always-stall",
      tool: "CUSTOM",
      custom: {
        launchBin: process.execPath,
        args: [
          "-e",
          [
            "const fs = require('fs');",
            "const file = process.env.COUNTER_FILE;",
            "let n = 0;",
            "try { n = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch {}",
            "n++;",
            "fs.writeFileSync(file, String(n));",
            "process.stdout.write('run ' + n + '\\n');",
            "setInterval(() => {}, 1000);"
          ].join("")
        ],
        env: { COUNTER_FILE: counterFile },
        messagePlacement: "stdin"
      }
    };
    const logs: Array<{ msg: string; extra?: unknown }> = [];
    const executor = new ToolExecutor({
      log: (msg, extra) => logs.push({ msg, extra }),
      stallTimeoutMs: 150,
      stallRetries: 2 // 3 runs total before failing
    });

    await expect(executor.execute(profile, "go")).rejects.toThrow(/stalled/i);
    expect(fs.readFileSync(counterFile, "utf8").trim()).toBe("3");
    const relaunches = logs.filter((entry) => entry.msg.includes("relaunching the same task"));
    expect(relaunches.length).toBe(2);
  });

  it("does not stall a child that keeps producing output", async () => {
    const profile: Profile = {
      name: "custom-chatty",
      tool: "CUSTOM",
      custom: {
        launchBin: process.execPath,
        args: [
          "-e",
          [
            "let i = 0;",
            "const t = setInterval(() => {",
            "  process.stdout.write('tick ' + i + '\\n');",
            "  if (++i >= 20) { clearInterval(t); process.exit(0); }",
            "}, 50);"
          ].join("")
        ],
        env: {},
        messagePlacement: "stdin"
      }
    };
    // Watchdog (500ms) is longer than the 50ms output cadence, so the child
    // must be allowed to run to completion instead of being killed.
    const executor = new ToolExecutor({ stallTimeoutMs: 500 });

    const output = await executor.execute(profile, "go");
    expect(output).toContain("tick 19");
  });
});
