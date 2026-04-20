import prompts from "prompts";
import { DaemonConfig, writeConfig, defaultConfigPath } from "./config.js";

export interface SetupIO {
  prompt: typeof prompts;
  log: (msg: string) => void;
}

const defaultIO: SetupIO = {
  prompt: prompts,
  log: (m) => process.stdout.write(m + "\n")
};

/** Exposed for tests — also used inline by `runSetup`. */
export const validators = {
  apiUrl: (v: string): true | string =>
    /^https?:\/\//.test(v) ? true : "Must be a http(s):// URL",
  apiKey: (v: string): true | string =>
    v.length >= 16 ? true : "Key must be ≥16 chars"
};

/**
 * Interactive walkthrough. Returns the path the config was written to,
 * or null if the user aborted.
 */
export async function runSetup(
  existing?: Partial<DaemonConfig>,
  io: SetupIO = defaultIO,
  targetPath: string = defaultConfigPath()
): Promise<string | null> {
  io.log("─── chatcoder-daemon setup ───");
  const answers = await io.prompt([
    {
      type: "text",
      name: "apiUrl",
      message: "Bot API URL (e.g. https://bot.example.com)",
      initial: existing?.apiUrl ?? "http://localhost:8080",
      validate: validators.apiUrl
    },
    {
      type: "password",
      name: "apiKey",
      message: "API key from the Telegram bot",
      initial: existing?.apiKey ?? "",
      validate: validators.apiKey
    },
    {
      type: "text",
      name: "command",
      message: "Command to execute (use $message as placeholder)",
      initial: existing?.command ?? 'codex --message "$message"'
    },
    {
      type: "text",
      name: "cwd",
      message: "Working directory for tool",
      initial: existing?.cwd ?? process.cwd()
    },
    {
      type: "toggle",
      name: "mirrorOutput",
      message: "Show tool output in daemon terminal?",
      initial: existing?.mirrorOutput ?? false,
      active: "yes",
      inactive: "no"
    }
  ]);

  if (!answers.apiUrl || !answers.apiKey) {
    io.log("Aborted.");
    return null;
  }

  const cfg = DaemonConfig.parse({
    apiUrl: answers.apiUrl,
    apiKey: answers.apiKey,
    command: answers.command || 'codex --message "$message"',
    cwd: answers.cwd || process.cwd(),
    mirrorOutput: !!answers.mirrorOutput
  });
  writeConfig(cfg, targetPath);
  io.log(`✓ wrote ${targetPath} (mode 0600)`);
  return targetPath;
}
