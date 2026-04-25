import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ensureCodexHome } from "./codexHome.js";
import type { Profile } from "./profile.js";
import { stripAnsi } from "./ansi.js";

export interface ExecuteOptions {
  onOutput?: (chunk: string) => void;
  /** Abort signal to kill the child process. */
  signal?: AbortSignal;
  /** true = pass resume flags to Claude/Codex CLIs. */
  resumeLastSession?: boolean;
}

export interface ToolExecutorOptions {
  log?: (msg: string, extra?: unknown) => void;
}

interface Launch {
  cmd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdinText: string | null;
}

/**
 * Keep a minimal set of host env vars so binaries like `claude` / `codex` can
 * find their libraries — but do NOT forward the daemon's own env, since that
 * could leak cross-profile secrets (e.g. a second profile's API key).
 */
function baseEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR"];
  const out: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export function buildLaunch(
  profile: Profile,
  message: string,
  resumeLastSession = true
): Launch {
  const env = baseEnv();

  if (profile.tool === "CLAUDE_CODE") {
    const c = profile.claudeCode;
    if (c.apiKey) env["ANTHROPIC_API_KEY"] = c.apiKey;
    if (c.baseUrl) env["ANTHROPIC_BASE_URL"] = c.baseUrl;
    const args: string[] = ["--print"];
    if (resumeLastSession) args.push("-c");
    if (c.model) args.push("--model", c.model);
    if (c.skipPermissions) args.push("--dangerously-skip-permissions");
    if (c.outputFormat && c.outputFormat !== "text") {
      args.push("--output-format", c.outputFormat);
    }
    args.push(...c.extraArgs);
    args.push(message);
    return {
      cmd: "claude",
      args,
      env,
      cwd: profile.cwd,
      stdinText: null
    };
  }

  if (profile.tool === "OPENAI") {
    const c = profile.codex;
    if (c.apiKey) env["OPENAI_API_KEY"] = c.apiKey;
    if (c.baseUrl) env["OPENAI_BASE_URL"] = c.baseUrl;
    if (c.apiKey || c.baseUrl) {
      const { codexHome } = ensureCodexHome(profile.name, c);
      env["CODEX_HOME"] = codexHome;
    }
    const args: string[] = resumeLastSession ? ["exec", "resume", "--last"] : ["exec"];
    if (c.bypassApprovalsAndSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else if (c.fullAuto) {
      args.push("--full-auto");
    } else {
      if (c.sandboxMode) args.push("--sandbox", c.sandboxMode);
      if (c.approvalMode) args.push("--ask-for-approval", c.approvalMode);
    }
    if (c.model) args.push("--model", c.model);
    args.push(...c.extraArgs);
    args.push(message);
    return {
      cmd: "codex",
      args,
      env,
      cwd: profile.cwd,
      stdinText: null
    };
  }

  // CUSTOM
  const c = profile.custom;
  for (const [k, v] of Object.entries(c.env)) {
    env[k] = v;
  }
  let args: string[];
  let stdinText: string | null = null;
  switch (c.messagePlacement) {
    case "stdin":
      args = c.args.slice();
      stdinText = message;
      break;
    case "placeholder":
      args = c.args.map((a) => a.replaceAll("$message", message));
      break;
    case "appended":
    default:
      args = [...c.args, message];
      break;
  }
  return {
    cmd: c.launchBin,
    args,
    env,
    cwd: profile.cwd,
    stdinText
  };
}

/**
 * Executes a profile with an instruction. Streams stdout+stderr (ANSI-stripped
 * via the caller's `onOutput`). Resolves with the full combined output; if the
 * child exits non-zero the output is returned anyway (exit code is appended
 * when there's nothing useful to show).
 */
export class ToolExecutor {
  private readonly log: (m: string, extra?: unknown) => void;

  constructor(private readonly opts: ToolExecutorOptions = {}) {
    this.log = opts.log ?? (() => void 0);
  }

  async execute(
    profile: Profile,
    message: string,
    execOpts: ExecuteOptions = {}
  ): Promise<string> {
    const launch = buildLaunch(profile, message, execOpts.resumeLastSession ?? true);
    this.log("executing", {
      profile: profile.name,
      cmd: launch.cmd,
      args: launch.args,
      cwd: launch.cwd
    });

    return new Promise<string>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(launch.cmd, launch.args, {
          cwd: launch.cwd,
          env: launch.env,
          stdio: ["pipe", "pipe", "pipe"]
        });
      } catch (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      const onAbort = (): void => {
        if (!child.killed) child.kill("SIGTERM");
      };
      execOpts.signal?.addEventListener("abort", onAbort);

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        execOpts.onOutput?.(chunk);
        stdout += chunk;
      });

      child.stderr.on("data", (data) => {
        const chunk = data.toString();
        execOpts.onOutput?.(chunk);
        stderr += chunk;
      });

      if (launch.stdinText !== null) {
        child.stdin.end(launch.stdinText);
      } else {
        child.stdin.end();
      }

      child.on("close", (code) => {
        execOpts.signal?.removeEventListener("abort", onAbort);
        const output = stripAnsi(stdout + stderr).trim();
        if (code === 0) {
          resolve(output);
        } else {
          resolve(output || `Command failed with exit code ${code ?? "null"}`);
        }
      });

      child.on("error", (err) => {
        execOpts.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  }
}
