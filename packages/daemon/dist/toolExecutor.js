import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCodexHome } from "./codexHome.js";
import { stripAnsi } from "./ansi.js";
import { registerToolPid, unregisterToolPid } from "./daemonState.js";
const DEFAULT_STALL_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_STALL_RETRIES = 3;
/** Thrown when the stall watchdog kills a child that produced no output for too long. */
export class StallTimeoutError extends Error {
    constructor(stallTimeoutMs) {
        super(`Execution stalled: no output from the tool for ` +
            `${Math.round(stallTimeoutMs / 1000)}s (stallTimeoutMs). ` +
            `The process was terminated after the relaunch attempts were exhausted — ` +
            `check the provider/network and retry.`);
        this.name = "StallTimeoutError";
    }
}
function codexFinalOutputPath(profileName) {
    const safeName = profileName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(tmpdir(), `chatcoder-codex-final-${safeName}-${process.pid}-${Date.now()}.txt`);
}
function readAndRemoveFinalOutput(path) {
    try {
        if (!existsSync(path))
            return "";
        return stripAnsi(readFileSync(path, "utf8")).trim();
    }
    finally {
        try {
            unlinkSync(path);
        }
        catch {
            // Best-effort cleanup only.
        }
    }
}
/**
 * Keep a minimal set of host env vars so binaries like `claude` / `codex` can
 * find their libraries — but do NOT forward the daemon's own env, since that
 * could leak cross-profile secrets (e.g. a second profile's API key).
 */
function baseEnv() {
    const allow = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "SHELL", "TMPDIR"];
    const out = {};
    for (const key of allow) {
        const v = process.env[key];
        if (v !== undefined)
            out[key] = v;
    }
    return out;
}
export function buildLaunch(profile, message, resumeLastSession = true, codexReasoningEffort, workDir) {
    const env = baseEnv();
    if (profile.tool === "CLAUDE_CODE") {
        const c = profile.claudeCode;
        if (c.baseUrl)
            env["ANTHROPIC_BASE_URL"] = c.baseUrl;
        if (c.authToken)
            env["ANTHROPIC_AUTH_TOKEN"] = c.authToken;
        if (c.defaultOpusModel)
            env["ANTHROPIC_DEFAULT_OPUS_MODEL"] = c.defaultOpusModel;
        if (c.defaultSonnetModel)
            env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = c.defaultSonnetModel;
        if (c.defaultHaikuModel)
            env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = c.defaultHaikuModel;
        if (c.disableNonessentialTraffic)
            env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "true";
        if (c.effortLevel)
            env["CLAUDE_CODE_EFFORT_LEVEL"] = c.effortLevel;
        const args = ["--print"];
        if (resumeLastSession)
            args.push("-c");
        if (c.model)
            args.push("--model", c.model);
        if (c.skipPermissions)
            args.push("--dangerously-skip-permissions");
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
        if (c.apiKey)
            env["OPENAI_API_KEY"] = c.apiKey;
        if (c.baseUrl)
            env["OPENAI_BASE_URL"] = c.baseUrl;
        const args = resumeLastSession ? ["exec", "resume", "--last"] : ["exec"];
        if (c.bypassApprovalsAndSandbox) {
            args.push("--dangerously-bypass-approvals-and-sandbox");
        }
        else if (c.fullAuto) {
            args.push("--full-auto");
        }
        else {
            if (c.sandboxMode)
                args.push("--sandbox", c.sandboxMode);
            if (c.approvalMode)
                args.push("--ask-for-approval", c.approvalMode);
        }
        if (c.model)
            args.push("--model", c.model);
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
        const args = ["run"];
        if (resumeLastSession)
            args.push("-c");
        if (c.model)
            args.push("--model", c.model);
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
    // CUSTOM
    const c = profile.custom;
    for (const [k, v] of Object.entries(c.env)) {
        env[k] = v;
    }
    let args;
    let stdinText = null;
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
    opts;
    log;
    constructor(opts = {}) {
        this.opts = opts;
        this.log = opts.log ?? (() => void 0);
    }
    async execute(profile, message, execOpts = {}) {
        const launch = buildLaunch(profile, message, execOpts.resumeLastSession ?? true, execOpts.codexReasoningEffort, execOpts.workDir);
        this.log("executing", {
            profile: profile.name,
            cmd: launch.cmd,
            args: launch.args,
            cwd: launch.cwd
        });
        const stallTimeoutMs = this.opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
        // 1 initial run + `stallRetries` relaunches of the same task after stalls.
        const maxAttempts = Math.max(1, (this.opts.stallRetries ?? DEFAULT_STALL_RETRIES) + 1);
        for (let attempt = 1;; attempt++) {
            try {
                return await this.runOnce(profile, launch, execOpts, stallTimeoutMs);
            }
            catch (err) {
                if (!(err instanceof StallTimeoutError))
                    throw err;
                // A user stop always wins — never relaunch after an abort.
                if (execOpts.signal?.aborted || attempt >= maxAttempts)
                    throw err;
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
    runOnce(profile, launch, execOpts, stallTimeoutMs) {
        return new Promise((resolve, reject) => {
            let child;
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
            }
            catch (err) {
                reject(err);
                return;
            }
            // Track the child in the daemon registry so a restart or crash of this
            // daemon can find and kill it (stale tools = frozen progress + CPU burn).
            if (child.pid) {
                registerToolPid(child.pid);
                const unregister = () => unregisterToolPid(child.pid);
                child.once("close", unregister);
                child.once("error", unregister);
            }
            let stdout = "";
            let stderr = "";
            let settled = false;
            let abortKillTimer = null;
            let stallTimer = null;
            // Set from the moment the stall watchdog fires until this run settles:
            // the stall rejection (not the natural close handler) owns the outcome,
            // so a killed child can't resolve the run as a "success".
            let stallRejectPending = false;
            /** SIGTERM then SIGKILL the whole process group — shared by abort and
             *  stall. The tool is the group leader (spawned detached), so
             *  kill(-pid) reaches the direct child AND any descendants it spawned
             *  (e.g. reasonix's node wrapper → the real CLI binary). */
            const killChild = () => {
                const pid = child.pid;
                if (pid === undefined)
                    return;
                try {
                    process.kill(-pid, "SIGTERM");
                }
                catch {
                    // Group already gone.
                }
                abortKillTimer ??= setTimeout(() => {
                    try {
                        process.kill(-pid, "SIGKILL");
                    }
                    catch {
                        // Already gone.
                    }
                }, 2_000);
            };
            const clearStallTimer = () => {
                if (stallTimer)
                    clearTimeout(stallTimer);
                stallTimer = null;
            };
            /** Resolves once the child has fully exited (or after a 3 s hard cap). */
            const waitForExit = () => {
                if (child.exitCode !== null || child.signalCode !== null) {
                    return Promise.resolve();
                }
                return new Promise((resolveExit) => {
                    child.once("close", () => resolveExit());
                    setTimeout(resolveExit, 3_000);
                });
            };
            /** (Re)arm the stall watchdog: kills the child if it goes silent too long. */
            const armStallWatchdog = () => {
                if (stallTimeoutMs <= 0)
                    return;
                clearStallTimer();
                stallTimer = setTimeout(() => {
                    stallTimer = null;
                    if (settled)
                        return;
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
            const settleResolve = (value) => {
                if (settled)
                    return;
                settled = true;
                execOpts.signal?.removeEventListener("abort", onAbort);
                if (abortKillTimer)
                    clearTimeout(abortKillTimer);
                clearStallTimer();
                resolve(value);
            };
            const settleReject = (err) => {
                if (settled)
                    return;
                settled = true;
                execOpts.signal?.removeEventListener("abort", onAbort);
                if (abortKillTimer)
                    clearTimeout(abortKillTimer);
                clearStallTimer();
                reject(err);
            };
            const emitOutput = (chunk) => {
                try {
                    execOpts.onOutput?.(chunk);
                }
                catch (err) {
                    this.log("output callback failed", { profile: profile.name, err });
                }
            };
            const onAbort = () => {
                killChild();
            };
            execOpts.signal?.addEventListener("abort", onAbort);
            if (execOpts.signal?.aborted)
                onAbort();
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
            }
            else {
                child.stdin.end();
            }
            child.on("close", (code) => {
                if (stallRejectPending)
                    return; // the stall rejection owns the outcome
                const output = stripAnsi(stdout + stderr).trim();
                const finalOutput = launch.finalOutputPath
                    ? readAndRemoveFinalOutput(launch.finalOutputPath)
                    : "";
                const responseOutput = finalOutput || output;
                if (code === 0) {
                    settleResolve(responseOutput);
                }
                else {
                    settleResolve(responseOutput || `Command failed with exit code ${code ?? "null"}`);
                }
            });
            child.on("error", (err) => {
                settleReject(err);
            });
        });
    }
}
//# sourceMappingURL=toolExecutor.js.map