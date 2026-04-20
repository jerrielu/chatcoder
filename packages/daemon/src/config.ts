import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const DaemonConfig = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(16),
  pollIntervalMs: z.number().int().min(50).max(60_000).default(2_000),
  pollJitterMs: z.number().int().min(0).max(5_000).default(250),
  heartbeatIntervalMs: z.number().int().min(50).max(60_000).default(15_000),
  idleShutdownMs: z.number().int().min(1_000).default(60 * 60_000),
  command: z.string().default("codex --message \"$message\""),
  cwd: z.string().default(process.cwd()),
  /** Idle period required before flushing a response chunk. */
  responseQuietMs: z.number().int().min(10).max(30_000).default(3_000),
  /** Whether to mirror tool output to the daemon's stdout. */
  mirrorOutput: z.boolean().default(false)
});

export type DaemonConfig = z.infer<typeof DaemonConfig>;

export function defaultConfigPath(): string {
  return path.join(os.homedir(), ".chatcoder-daemon", "config.yml");
}

export function loadConfig(p = defaultConfigPath()): DaemonConfig {
  const raw = fs.readFileSync(p, "utf8");
  const parsed = parseYaml(raw);
  return DaemonConfig.parse(parsed);
}

export function writeConfig(cfg: DaemonConfig, p = defaultConfigPath()): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, stringifyYaml(cfg), { mode: 0o600 });
}
