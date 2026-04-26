import type { CodexConfig } from "./profile.js";
/**
 * Scoped Codex home directory per profile.
 *
 * Codex reads `~/.codex/config.toml` + `~/.codex/auth.json` by default.
 * When the daemon runs several Codex profiles against different API keys or
 * base URLs, sharing that directory would clobber keys between profiles.
 * We instead write a per-profile directory under
 * `$HOME/.chatcoder-daemon/codex/<name>/` and set `CODEX_HOME` for the
 * spawned child process.
 *
 * The TOML and JSON writers are TS ports of coder:611-919 — same target
 * shape, without AWK.
 */
export declare const DEFAULT_CODEX_BASE_URL = "https://api.openai.com/v1";
export declare function setCodexRootOverride(root: string | null): void;
export declare function setSourceCodexHomeOverride(root: string | null): void;
export declare function codexHomeRoot(): string;
export declare function codexHomeFor(profileName: string): string;
/** Template for the per-profile config.toml. */
export declare function renderCodexConfigToml(codex: CodexConfig): string;
/** Template for the per-profile auth.json. */
export declare function renderCodexAuthJson(codex: CodexConfig): string;
interface WriteResult {
    codexHome: string;
    changed: boolean;
}
/**
 * Ensures the scoped CODEX_HOME exists and is up to date. Uses a content
 * hash marker so subsequent calls with identical config are no-ops.
 */
export declare function ensureCodexHome(profileName: string, codex: CodexConfig): WriteResult;
export {};
//# sourceMappingURL=codexHome.d.ts.map