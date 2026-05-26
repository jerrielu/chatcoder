import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { MAX_PROFILES_PER_DAEMON, MIN_API_KEY_LENGTH } from "@chatcoder/shared";
import { Profile } from "./profile.js";

export const DaemonConfig = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(MIN_API_KEY_LENGTH),
  pollIntervalMs: z.number().int().min(50).max(60_000).default(2_000),
  pollJitterMs: z.number().int().min(0).max(5_000).default(250),
  heartbeatIntervalMs: z.number().int().min(50).max(60_000).default(15_000),
  idleShutdownMs: z.number().int().min(1_000).default(60 * 60_000),
  /** Global in-flight cap across profiles. */
  maxConcurrency: z.number().int().min(1).max(32).default(4),
  profiles: z.array(Profile).min(1).max(MAX_PROFILES_PER_DAEMON),
  workDirs: z.array(z.string()).default([])
});

export type DaemonConfig = z.infer<typeof DaemonConfig>;

export function defaultConfigPath(): string {
  return path.join(os.homedir(), ".chatcoder", "config.yml");
}

export function loadConfig(p = defaultConfigPath()): DaemonConfig {
  const raw = fs.readFileSync(p, "utf8");
  const parsed = parseYaml(raw);
  return DaemonConfig.parse(parsed);
}

/** Load raw YAML data without Zod validation — returns null if file missing or unparseable. */
export function loadRawConfig(p = defaultConfigPath()): Record<string, unknown> | null {
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, "utf8");
    return parseYaml(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Write raw YAML without Zod validation — used by menu to save partial configs. */
export function writeRawConfig(
  data: Record<string, unknown>,
  p = defaultConfigPath()
): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, stringifyYaml(data), { mode: 0o600 });
}

export function writeConfig(cfg: DaemonConfig, p = defaultConfigPath()): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, stringifyYaml(cfg), { mode: 0o600 });
}
