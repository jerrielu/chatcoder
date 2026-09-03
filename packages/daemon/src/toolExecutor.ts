import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexReasoningEffort } from "@chatcoder/shared";
import { ensureCodexHome } from "./codexHome.js";
import type { Profile } from "./profile.js";
import { stripAnsi } from "./ansi.js";
import { registerToolPid, unregisterToolPid } from "./daemonState.js";
import { createCommandCodeStreamTranslator } from "./commandCodeStream.js";

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
  /**
   * Stall watchdog: if the child process emits no output (stdout/stderr) for
   * this long, it is killed and the execution rejects with a descriptive error
   * so the session completes instead of showing a frozen progress message
   * forever. `0` disables the watchdog. Defaults to 15 minutes.
   */
  stallTimeoutMs?: number;
  /**
   * After a stall timeout the stalled child is killed and the **same task is
   * relaunched** (same message, same resume flags), so progress keeps updating
   * under the same session instead of erroring out. This is how many times a
   * stalled run may be relaunched before the execution finally fails; `0`
   * disables the relaunch (fail immediately on the first stall). Defaults to 3.
   */
  stallRetries?: number;
}

const DEFAULT_STALL_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_STALL_RETRIES = 3;

/** Thrown when the stall watchdog kills a child that produced no output for too long. */
export class StallTimeoutError extends Error {
  constructor(stallTimeoutMs: number) {
    super(
      `Execution stalled: no output from the tool for ` +
        `${Math.round(stallTimeoutMs / 1000)}s (stallTimeoutMs). ` +
        `The process was terminated after the relaunch attempts were exhausted — ` +
        `check the provider/network and retry.`
    );
    this.name = "StallTimeoutError";
  }
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
    // Forced: reasonix always runs in auto permission mode (cannot be
    // overridden by profile extraArgs). See design.md §reasonix-auto-mode.
    args.push("--permission-mode", "auto");
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

  if (profile.tool === "COMMAND_CODE") {
    const c = profile.commandCode;
    const args: string[] = ["-p"];
    // Forced: cmd always runs headless with bypassed permission prompts
    // (cannot be overridden by profile extraArgs).
    args.push("--yolo");
    // Forced: always run with NDJSON event stream output so the daemon can
    // surface live progress (assistant text deltas + tool notes) and pull
    // the final `result.finalText` on close. Without this cmd emits the
    // final answer only after a long silence, so the Telegram "🔄
    // processing…" message looks frozen and `response.txt` is just whatever
    // leaked onto stdout/stderr.
    args.push("--output-format", "json");
    if (resumeLastSession) args.push("-c");
    if (c.model) args.push("--model", c.model);
    args.push(...c.extraArgs);
    // Forced: cap agent turns at an effectively-unlimited number so long-running
    // daemon tool invocations aren't cut off mid-task (cannot be overridden by
    // profile extraArgs).
    args.push("--max-turns", "999999999");
    args.push(message);
    return {
      cmd: "cmd",
      args,
      env,
      cwd: workDir ?? process.cwd(),
      stdinText: null,
      finalOutputPath: null
    };
  }

  if (profile.tool === "ANTIGRAVITY") {
    const c = profile.antigravity;
    const args: string[] = ["--print", message];
    if (c.model) args.push("--model", c.model);
    if (c.effortLevel) args.push("--effort", c.effortLevel);
    args.push(...c.extraArgs);
    // Forced: agy always runs in yolo mode (cannot be overridden by profile extraArgs).
    args.push("--dangerously-skip-permissions");
    if (resumeLastSession) args.push("-c");
    return {
      cmd: "agy",
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
    const stallTimeoutMs = this.opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    // 1 initial run + `stallRetries` relaunches of the same task after stalls.
    const maxAttempts = Math.max(1, (this.opts.stallRetries ?? DEFAULT_STALL_RETRIES) + 1);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.runOnce(profile, launch, execOpts, stallTimeoutMs);
      } catch (err) {
        if (!(err instanceof StallTimeoutError)) throw err;
        // A user stop always wins — never relaunch after an abort.
        if (execOpts.signal?.aborted || attempt >= maxAttempts) throw err;
        this.log("tool execution stalled — killing and relaunching the same task", {
          profile: profile.name,
          attempt,
          maxAttempts
        });
      }
    }
  }

  /**
   * Runs a single launch of the tool. Streams stdout+stderr (ANSI-stripped via
   * the caller's `onOutput`) and resolves with the full combined output; if the
   * child exits non-zero the output is returned anyway (exit code is appended
   * when there's nothing useful to show). Rejects with `StallTimeoutError` when
   * the child emits no output for `stallTimeoutMs` — only after the child has
   * fully exited, so the caller can relaunch the same task without two
   * processes racing over the same resume session / final-output file.
   */
  private runOnce(
    profile: Profile,
    launch: Launch,
    execOpts: ExecuteOptions,
    stallTimeoutMs: number
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      // Command Code runs in JSON mode: the daemon translates the NDJSON
      // stream into incremental progress for `onOutput` and captures the
      // terminal `result.finalText` for the close handler. Other tools pass
      // raw chunks straight through.
      const isCommandCode = profile.tool === "COMMAND_CODE";
      const commandCodeStream = isCommandCode
        ? createCommandCodeStreamTranslator()
        : null;
      const callerOnOutput = execOpts.onOutput;
      const onOutput: ExecuteOptions["onOutput"] = commandCodeStream
        ? (chunk) => {
            const delta = commandCodeStream.ingest(chunk);
            if (delta.length > 0) callerOnOutput?.(delta);
          }
        : callerOnOutput;

      let child: ChildProcessWithoutNullStreams;
      try {
        // detached: true gives the tool its own process group (PGID = child
        // PID). The tool CLIs are two-level (a node wrapper that spawns the
        // real binary), so killing just the direct child orphans the binary —
        // the stall/abort/cleanup paths kill the whole group instead.
        child = spawn(launch.cmd, launch.args, {
          cwd: launch.cwd,
          env: launch.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: true
        });
      } catch (err) {
        reject(err);
        return;
      }
      // Track the child in the daemon registry so a restart or crash of this
      // daemon can find and kill it (stale tools = frozen progress + CPU burn).
      if (child.pid) {
        registerToolPid(child.pid);
        const unregister = (): void => unregisterToolPid(child.pid!);
        child.once("close", unregister);
        child.once("error", unregister);
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      let abortKillTimer: ReturnType<typeof setTimeout> | null = null;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      // Set from the moment the stall watchdog fires until this run settles:
      // the stall rejection (not the natural close handler) owns the outcome,
      // so a killed child can't resolve the run as a "success".
      let stallRejectPending = false;

      /** SIGTERM then SIGKILL the whole process group — shared by abort and
       *  stall. The tool is the group leader (spawned detached), so
       *  kill(-pid) reaches the direct child AND any descendants it spawned
       *  (e.g. reasonix's node wrapper → the real CLI binary). */
      const killChild = (): void => {
        const pid = child.pid;
        if (pid === undefined) return;
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          // Group already gone.
        }
        abortKillTimer ??= setTimeout(() => {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            // Already gone.
          }
        }, 2_000);
      };

      const clearStallTimer = (): void => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = null;
      };

      /** Resolves once the child has fully exited (or after a 3 s hard cap). */
      const waitForExit = (): Promise<void> => {
        if (child.exitCode !== null || child.signalCode !== null) {
          return Promise.resolve();
        }
        return new Promise<void>((resolveExit) => {
          child.once("close", () => resolveExit());
          setTimeout(resolveExit, 3_000);
        });
      };

      /** (Re)arm the stall watchdog: kills the child if it goes silent too long. */
      const armStallWatchdog = (): void => {
        if (stallTimeoutMs <= 0) return;
        clearStallTimer();
        stallTimer = setTimeout(() => {
          stallTimer = null;
          if (settled) return;
          this.log("tool execution stalled — killing process", {
            profile: profile.name,
            pid: child.pid,
            stallTimeoutMs
          });
          stallRejectPending = true;
          killChild();
          // Wait for the child to actually die before rejecting so the retry
          // loop can relaunch the same task without racing the dying process.
          void waitForExit().then(() => {
            settleReject(new StallTimeoutError(stallTimeoutMs));
          });
        }, stallTimeoutMs);
      };

      const settleResolve = (value: string): void => {
        if (settled) return;
        settled = true;
        execOpts.signal?.removeEventListener("abort", onAbort);
        if (abortKillTimer) clearTimeout(abortKillTimer);
        clearStallTimer();
        resolve(value);
      };

      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        execOpts.signal?.removeEventListener("abort", onAbort);
        if (abortKillTimer) clearTimeout(abortKillTimer);
        clearStallTimer();
        reject(err);
      };

      const emitOutput = (chunk: string): void => {
        try {
          onOutput?.(chunk);
        } catch (err) {
          this.log("output callback failed", { profile: profile.name, err });
        }
      };

      const onAbort = (): void => {
        killChild();
      };
      execOpts.signal?.addEventListener("abort", onAbort);
      if (execOpts.signal?.aborted) onAbort();

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        emitOutput(chunk);
        stdout += chunk;
        armStallWatchdog();
      });

      child.stderr.on("data", (data) => {
        const chunk = data.toString();
        emitOutput(chunk);
        stderr += chunk;
        armStallWatchdog();
      });

      child.stdout.on("error", (err) => {
        this.log("stdout stream error", { profile: profile.name, err });
      });

      child.stderr.on("error", (err) => {
        this.log("stderr stream error", { profile: profile.name, err });
      });

      // Start the stall watchdog; re-armed on every stdout/stderr chunk above.
      armStallWatchdog();

      child.stdin.on("error", (err) => {
        this.log("stdin stream error", { profile: profile.name, err });
      });

      if (launch.stdinText !== null) {
        child.stdin.end(launch.stdinText);
      } else {
        child.stdin.end();
      }

      child.on("close", (code) => {
        if (stallRejectPending) return; // the stall rejection owns the outcome
        // For Command Code we always prefer the `result.finalText` we parsed
        // out of the NDJSON stream — that's the assistant's real final
        // answer. The raw JSON in `stdout` would otherwise leak into the
        // response (and into response.txt).
        const commandCodeResult = commandCodeStream?.finalize();
        if (commandCodeResult?.hasResult) {
          settleResolve(commandCodeResult.finalText);
          return;
        }
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
