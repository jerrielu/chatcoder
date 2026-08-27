import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Profile } from "./profile.js";

/** How long to wait for `cmd --list-models` before giving up. */
const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Auto-generated profiles are prefixed with this marker so the daemon can
 * replace the whole set on every restart without touching user-authored
 * profiles.
 */
export const CMD_PROFILE_PREFIX = "cmd+";

export function commandCodeModelsCachePath(): string {
  return path.join(os.homedir(), ".chatcoder", "command-code-models.json");
}

interface ModelCacheFile {
  models: string[];
  refreshedAt: number;
}

/**
 * Map a Command Code model id to a profile-name-safe suffix: `/` and any
 * other character outside the slug set become `_`
 * (e.g. `Qwen/Qwen3.8-Max` → `Qwen_Qwen3.8-Max`).
 */
export function sanitizeModelName(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9_.+-]/g, "_");
}

/** Build one COMMAND_CODE auto-profile per discovered model. */
export function buildAutoProfiles(models: string[]): Profile[] {
  const seen = new Set<string>();
  const out: Profile[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (trimmed.length === 0) continue;
    const name = `${CMD_PROFILE_PREFIX}${sanitizeModelName(trimmed)}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      tool: "COMMAND_CODE",
      commandCode: {
        model: trimmed,
        extraArgs: []
      }
    });
  }
  return out;
}

/**
 * Parse the text output of `cmd --list-models` into model ids. The exact
 * layout may change between CLI versions; we extract tokens that look like
 * model ids (letters/digits/._- with an optional provider prefix like
 * `Qwen/…`) and skip table decoration, headers, and prose lines.
 */
export function parseModelListOutput(stdout: string): string[] {
  const models = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    for (const token of line.split(/\s+/)) {
      // Strip common list decorations (bullets, quotes, trailing commas).
      const candidate = token.replace(/^[-*`"']+/, "").replace(/[`"'],?$/, "");
      // A model id starts alphanumeric, contains a letter or digit, and has
      // no shell-hostile characters. Provider-qualified ids carry a `/`.
      if (!/^[A-Za-z][A-Za-z0-9._/-]*[A-Za-z0-9]$/.test(candidate)) continue;
      if (candidate.length < 3) continue;
      // Skip obvious non-model words that appear in help/table output.
      if (/^(the|and|for|with|from|model|models|name|id|efforts|context)$/i.test(candidate)) continue;
      models.add(candidate);
    }
  }
  return [...models];
}

/**
 * Run `cmd --list-models` and return the discovered model ids.
 * Returns null when cmd is missing, times out, errors, or prints nothing
 * usable — callers fall back to the cache file.
 */
export function discoverCommandCodeModels(
  log?: (m: string, extra?: unknown) => void
): string[] | null {
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync("cmd", ["--list-models"], {
      encoding: "utf8",
      timeout: DISCOVERY_TIMEOUT_MS
    });
  } catch (err) {
    log?.("cmd --list-models failed to spawn", { err });
    return null;
  }
  if (result.error || result.status !== 0) {
    log?.("cmd --list-models failed", {
      status: result.status,
      error: result.error?.message ?? null,
      stderr: result.stderr?.slice(0, 500)
    });
    return null;
  }
  const models = parseModelListOutput(typeof result.stdout === "string" ? result.stdout : "");
  return models.length > 0 ? models : null;
}

function readCache(): ModelCacheFile | null {
  try {
    const raw = fs.readFileSync(commandCodeModelsCachePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ModelCacheFile>;
    if (!Array.isArray(parsed.models)) return null;
    const models = parsed.models.filter((m): m is string => typeof m === "string");
    return { models, refreshedAt: Number(parsed.refreshedAt ?? 0) };
  } catch {
    return null;
  }
}

function writeCache(models: string[]): void {
  const file = commandCodeModelsCachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: ModelCacheFile = { models, refreshedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Discover models and refresh the on-disk cache. Returns fresh ids on
 * success; on failure returns the cached ids (or null when there is none).
 * Never throws — discovery is best-effort by design.
 */
export function refreshModelCache(
  log?: (m: string, extra?: unknown) => void
): string[] | null {
  const fresh = discoverCommandCodeModels(log);
  if (fresh !== null) {
    writeCache(fresh);
    return fresh;
  }
  const cached = readCache();
  if (cached) {
    log?.("cmd discovery failed — using cached model list", {
      refreshedAt: new Date(cached.refreshedAt).toISOString(),
      count: cached.models.length
    });
    return cached.models;
  }
  return null;
}

/** Read the last successfully-discovered model list (no refresh). */
export function getCachedModels(): string[] | null {
  return readCache()?.models ?? null;
}
