import type { CodexReasoningEffort } from "@chatcoder/shared";
import type { Profile } from "./profile.js";
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
    /** Skip the summary instruction wrapper (used for retry summarization calls). */
    skipSummaryWrapper?: boolean;
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
export declare const SUMMARY_INSTRUCTION = "When you finish, output your final response as a JSON object with exactly one key: \"summary\". The value must be a concise summary of what was done and key results. Do not include any other text outside the JSON object.";
export declare function wrapWithSummaryPolicy(message: string): string;
export declare function buildLaunch(profile: Profile, message: string, resumeLastSession?: boolean, codexReasoningEffort?: CodexReasoningEffort, workDir?: string): Launch;
/**
 * Executes a profile with an instruction. Streams stdout+stderr (ANSI-stripped
 * via the caller's `onOutput`). Resolves with the full combined output; if the
 * child exits non-zero the output is returned anyway (exit code is appended
 * when there's nothing useful to show).
 */
export declare class ToolExecutor {
    private readonly opts;
    private readonly log;
    constructor(opts?: ToolExecutorOptions);
    execute(profile: Profile, message: string, execOpts?: ExecuteOptions): Promise<string>;
}
export {};
//# sourceMappingURL=toolExecutor.d.ts.map