import { spawn } from "node:child_process";
import type { DaemonConfig } from "./config.js";
import { stripAnsi } from "./ansi.js";

export interface ToolExecutorOptions {
  config: DaemonConfig;
  log?: (msg: string, extra?: unknown) => void;
}

export class ToolExecutor {
  private readonly log: (m: string, extra?: unknown) => void;

  constructor(private readonly opts: ToolExecutorOptions) {
    this.log = opts.log ?? (() => void 0);
  }

  async execute(message: string): Promise<string> {
    const fullCommand = this.opts.config.command.replaceAll("$message", message);
    this.log("executing command", fullCommand);

    return new Promise((resolve, reject) => {
      // Use /bin/sh to support shell-like command strings (pipes, redirects, etc.)
      // but the user might want a more direct execution if they provided a single binary.
      // However, the placeholder $message usually implies a shell string.
      const child = spawn(fullCommand, {
        shell: true,
        cwd: this.opts.config.cwd,
        env: { ...process.env }
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (this.opts.config.mirrorOutput) {
          process.stdout.write(chunk);
        }
      });

      child.stderr.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (this.opts.config.mirrorOutput) {
          process.stderr.write(chunk);
        }
      });

      child.on("close", (code) => {
        const output = stripAnsi(stdout + stderr).trim();
        if (code === 0) {
          resolve(output);
        } else {
          // Even if exit code is non-zero, we might want to return the output
          // as it might contain useful error messages for the user.
          resolve(output || `Command failed with exit code ${code}`);
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }
}
