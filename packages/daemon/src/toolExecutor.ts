import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexReasoningEffort } from "@chatcoder/shared";
import { ensureCodexHome } from "./codexHome.js";
import type { Profile } from "./profile.js";
import { stripAnsi } from "./ansi.js";

export interface ExecuteOptions {
  onOutput?: (chunk: string) => void;
  /** Abort signal to kill the child process. */
  signal?: AbortSignal;
  /** true = pass resume flags to Claude/Codex CLIs. */
  resumeLastSession?: boolean;
  /** Optional per-instruction Codex reasoning effort override. */
  codexReasoningEffort?: CodexReasoningEffort;
  /** Working directory for the spawned process. */
  workDir?: string;
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
  finalOutputPath: string | null;
}

function codexFinalOutputPath(profileName: string): string {
  const safeName = profileName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), `chatcoder-codex-final-${safeName}-${process.pid}-${Date.now()}.txt`);
}

function readAndRemoveFinalOutput(path: string): string {
  try {
    if (!existsSync(path)) return "";
    return stripAnsi(readFileSync(path, "utf8")).trim();
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Best-effort cleanup only.
    }
  }
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
  resumeLastSession = true,
  codexReasoningEffort?: CodexReasoningEffort,
  workDir?: string
): Launch {
  const env = baseEnv();

  if (profile.tool === "CLAUDE_CODE") {
    const c = profile.claudeCode;
    if (c.baseUrl) env["ANTHROPIC_BASE_URL"] = c.baseUrl;
    if (c.authToken) env["ANTHROPIC_AUTH_TOKEN"] = c.authToken;
    if (c.defaultOpusModel) env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = c.defaultOpusModel;
    if (c.defaultSonnetModel) env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = c.defaultSonnetModel;
    if (c.defaultHaikuModel) env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = c.defaultHaikuModel;
    if (c.disableNonessentialTraffic) env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "true";
    if (c.effortLevel) env["CLAUDE_CODE_EFFORT_LEVEL"] = c.effortLevel;
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
      cwd: workDir ?? process.cwd(),
      stdinText: null,
      finalOutputPath: null
    };
  }

  if (profile.tool === "OPENAI") {
    const c = profile.codex;
    const finalOutputPath = codexFinalOutputPath(profile.name);
    const { codexHome } = ensureCodexHome(profile.name, c);
    env["CODEX_HOME"] = codexHome;
    if (c.apiKey) env["OPENAI_API_KEY"] = c.apiKey;
    if (c.baseUrl) env["OPENAI_BASE_URL"] = c.baseUrl;
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
    if (codexReasoningEffort) {
      args.push("-c", `model_reasoning_effort=${codexReasoningEffort}`);
    }
    args.push(...c.extraArgs);
    args.push("-o", finalOutputPath);
    args.push(message);
    return {
      cmd: "codex",
      args,
      env,
      cwd: workDir ?? process.cwd(),
      stdinText: null,
      finalOutputPath
    };
  }

  if (profile.tool === "REASONIX") {
    const c = profile.reasonix;
    const args: string[] = ["run"];
    if (resumeLastSession) args.push("-c");
    if (c.model) args.push("--model", c.model);
    args.push(...c.extraArgs);
    args.push(message);
    return {
      cmd: "reasonix",
      args,
      env,
      cwd: workDir ?? process.cwd(),
      stdinText: null,
      finalOutputPath: null
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
    cwd: workDir ?? process.cwd(),
    stdinText,
    finalOutputPath: null
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
    const launch = buildLaunch(
      profile,
      message,
      execOpts.resumeLastSession ?? true,
      execOpts.codexReasoningEffort,
      execOpts.workDir
    );
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
      let settled = false;
      let abortKillTimer: ReturnType<typeof setTimeout> | null = null;

      const settleResolve = (value: string): void => {
        if (settled) return;
        settled = true;
        execOpts.signal?.removeEventListener("abort", onAbort);
        if (abortKillTimer) clearTimeout(abortKillTimer);
        resolve(value);
      };

      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        execOpts.signal?.removeEventListener("abort", onAbort);
        if (abortKillTimer) clearTimeout(abortKillTimer);
        reject(err);
      };

      const emitOutput = (chunk: string): void => {
        try {
          execOpts.onOutput?.(chunk);
        } catch (err) {
          this.log("output callback failed", { profile: profile.name, err });
        }
      };

      const onAbort = (): void => {
        if (!child.killed) child.kill("SIGTERM");
        abortKillTimer ??= setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        }, 2_000);
      };
      execOpts.signal?.addEventListener("abort", onAbort);
      if (execOpts.signal?.aborted) onAbort();

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        emitOutput(chunk);
        stdout += chunk;
      });

      child.stderr.on("data", (data) => {
        const chunk = data.toString();
        emitOutput(chunk);
        stderr += chunk;
      });

      child.stdout.on("error", (err) => {
        this.log("stdout stream error", { profile: profile.name, err });
      });

      child.stderr.on("error", (err) => {
        this.log("stderr stream error", { profile: profile.name, err });
      });

      child.stdin.on("error", (err) => {
        this.log("stdin stream error", { profile: profile.name, err });
      });

      if (launch.stdinText !== null) {
        child.stdin.end(launch.stdinText);
      } else {
        child.stdin.end();
      }

      child.on("close", (code) => {
        const output = stripAnsi(stdout + stderr).trim();
        const finalOutput = launch.finalOutputPath
          ? readAndRemoveFinalOutput(launch.finalOutputPath)
          : "";
        const responseOutput = finalOutput || output;
        if (code === 0) {
          settleResolve(responseOutput);
        } else {
          settleResolve(responseOutput || `Command failed with exit code ${code ?? "null"}`);
        }
      });

      child.on("error", (err) => {
        settleReject(err);
      });
    });
  }
}
