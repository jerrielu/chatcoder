import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import type { CodexConfig } from "./profile.js";

/**
 * Scoped Codex home directory per profile.
 *
 * Codex reads `~/.codex/config.toml` + `~/.codex/auth.json` by default.
 * When the daemon runs several Codex profiles against different API keys or
 * base URLs, sharing that directory would clobber keys between profiles.
 * We instead write a per-profile directory under
 * `$HOME/.chatcoder/<name>/` and set `CODEX_HOME` for the
 * spawned child process.
 *
 * The TOML and JSON writers are TS ports of coder:611-919 — same target
 * shape, without AWK.
 */
export const DEFAULT_CODEX_BASE_URL = "https://api.openai.com/v1";

/**
 * Optional override for the root directory that holds per-profile Codex
 * configs. `null` means "derive from HOME" (the default). Tests set this to
 * a temp dir so they never touch the user's real `~/.chatcoder/`.
 */
let codexRootOverride: string | null = null;
let sourceCodexHomeOverride: string | null = null;

export function setCodexRootOverride(root: string | null): void {
  codexRootOverride = root;
}

export function setSourceCodexHomeOverride(root: string | null): void {
  sourceCodexHomeOverride = root;
}

export function codexHomeRoot(): string {
  if (codexRootOverride !== null) return codexRootOverride;
  return path.join(os.homedir(), ".chatcoder");
}

function sourceCodexHome(): string {
  if (sourceCodexHomeOverride !== null) return sourceCodexHomeOverride;
  return path.join(os.homedir(), ".codex");
}

export function codexHomeFor(profileName: string): string {
  return path.join(codexHomeRoot(), profileName);
}

/** Template for the per-profile config.toml. */
export function renderCodexConfigToml(codex: CodexConfig): string {
  const baseUrl = codex.baseUrl ?? DEFAULT_CODEX_BASE_URL;
  const escaped = baseUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return (
    `model_provider = "OpenAI"\n` +
    `\n` +
    `[model_providers.OpenAI]\n` +
    `name = "OpenAI"\n` +
    `base_url = "${escaped}"\n` +
    `wire_api = "responses"\n` +
    `supports_websockets = true\n` +
    `requires_openai_auth = true\n`
  );
}

/** Template for the per-profile auth.json. */
export function renderCodexAuthJson(codex: CodexConfig): string {
  if (!codex.apiKey) {
    throw new Error("Cannot render Codex auth.json without an API key");
  }
  return (
    JSON.stringify(
      {
        auth_mode: "apikey",
        OPENAI_API_KEY: codex.apiKey
      },
      null,
      2
    ) + "\n"
  );
}

interface WriteResult {
  codexHome: string;
  changed: boolean;
}

function readFileIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolvedConfigContent(codexHome: string, codex: CodexConfig): string {
  if (codex.baseUrl) return renderCodexConfigToml(codex);

  const existing = readFileIfExists(path.join(codexHome, "config.toml"));
  if (existing !== null) return existing;

  const source = readFileIfExists(path.join(sourceCodexHome(), "config.toml"));
  if (source !== null) return source;

  return renderCodexConfigToml(codex);
}

function resolvedAuthContent(codexHome: string, codex: CodexConfig): string | null {
  if (codex.apiKey) return renderCodexAuthJson(codex);

  const existing = readFileIfExists(path.join(codexHome, "auth.json"));
  if (existing !== null) return existing;

  return readFileIfExists(path.join(sourceCodexHome(), "auth.json"));
}

/**
 * Ensures the scoped CODEX_HOME exists and is up to date. Uses a content
 * hash marker so subsequent calls with identical config are no-ops.
 */
export function ensureCodexHome(profileName: string, codex: CodexConfig): WriteResult {
  const codexHome = codexHomeFor(profileName);
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });

  const configContent = resolvedConfigContent(codexHome, codex);
  const authContent = resolvedAuthContent(codexHome, codex);

  const marker = path.join(codexHome, ".chatcoder-hash");
  const hash = createHash("sha256")
    .update(configContent)
    .update("\0")
    .update(authContent ?? "")
    .digest("hex");

  let existingHash: string | null = null;
  try {
    existingHash = fs.readFileSync(marker, "utf8").trim();
  } catch {
    existingHash = null;
  }

  if (existingHash === hash) {
    return { codexHome, changed: false };
  }

  fs.writeFileSync(path.join(codexHome, "config.toml"), configContent, { mode: 0o600 });
  const authPath = path.join(codexHome, "auth.json");
  if (authContent !== null) {
    fs.writeFileSync(authPath, authContent, { mode: 0o600 });
  } else if (fs.existsSync(authPath)) {
    fs.rmSync(authPath);
  }
  fs.writeFileSync(marker, hash + "\n", { mode: 0o600 });
  return { codexHome, changed: true };
}
