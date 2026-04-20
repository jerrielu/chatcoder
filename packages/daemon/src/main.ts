#!/usr/bin/env node
import * as fs from "node:fs";
import { defaultConfigPath, loadConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { ApiClient } from "./client.js";
import { Orchestrator } from "./orchestrator.js";
import { ToolExecutor } from "./toolExecutor.js";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "run";

  if (cmd === "setup") {
    const path = await runSetup();
    if (!path) process.exit(1);
    return;
  }

  if (cmd === "run") {
    if (!fs.existsSync(defaultConfigPath())) {
      console.log(`[daemon] No configuration found at ${defaultConfigPath()}`);
      console.log(`[daemon] Starting first-time setup guide...\n`);
      const path = await runSetup();
      if (!path) {
        console.error("[daemon] Setup aborted. Configuration is required to run the daemon.");
        process.exit(1);
      }
      console.log("");
    }
    const cfg = loadConfig();
    const client = new ApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey });
    const log = (m: string, extra?: unknown) => console.log(`[daemon] ${m}`, extra ?? "");
    const tool = new ToolExecutor({ config: cfg, log });
    const orch = new Orchestrator({
      config: cfg,
      client,
      tool,
      log
    });
    orch.start();
    console.log(`[daemon] running — heartbeat ${cfg.heartbeatIntervalMs}ms poll ${cfg.pollIntervalMs}ms`);

    const stop = async (sig: string): Promise<void> => {
      console.log(`[daemon] ${sig} — stopping`);
      await orch.stop();
      process.exit(0);
    };
    process.once("SIGINT", () => void stop("SIGINT"));
    process.once("SIGTERM", () => void stop("SIGTERM"));
    return;
  }

  if (cmd === "config-path") {
    process.stdout.write(defaultConfigPath() + "\n");
    return;
  }

  process.stderr.write(`usage: chatcoder-daemon <setup|run|config-path>\n`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
