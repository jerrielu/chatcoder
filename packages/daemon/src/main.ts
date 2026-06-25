#!/usr/bin/env node
import * as fs from "node:fs";
import { defaultConfigPath, loadConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { showMainMenu } from "./menu.js";
import { ApiClient } from "./client.js";
import { Orchestrator } from "./orchestrator.js";
import { ProfilePool } from "./profilePool.js";
import { ToolExecutor } from "./toolExecutor.js";

function normalizeCommand(raw: string | undefined): string {
  if (!raw) return "menu";
  if (raw === "--daemon") return "run";
  return raw;
}


async function runDaemon(): Promise<void> {
  if (!fs.existsSync(defaultConfigPath())) {
    console.log(`[daemon] No configuration found at ${defaultConfigPath()}`);
    console.log("[daemon] Starting first-time setup guide...\n");
    const path = await runSetup();
    if (!path) {
      console.error("[daemon] Setup aborted. Configuration is required to run the daemon.");
      process.exit(1);
    }
    console.log("");
  }

  const cfg = loadConfig();
  const log = (m: string, extra?: unknown): void => {
    // eslint-disable-next-line no-console
    console.log(`[daemon] ${m}`, extra ?? "");
  };
  const client = new ApiClient({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey });

  log("registering profiles with bot", {
    count: cfg.profiles.length,
    names: cfg.profiles.map((p) => p.name)
  });
  try {
    await client.register({
      profiles: cfg.profiles.map((p) => ({
        name: p.name,
        tool: p.tool,
        ...(p.metadata !== undefined ? { metadata: p.metadata } : {})
      })),
      workDirs: cfg.workDirs.length > 0 ? cfg.workDirs : undefined
    });
  } catch (err) {
    console.error("[daemon] register failed:", err);
    process.exit(1);
  }

  const tool = new ToolExecutor({ log });
  const pool = new ProfilePool({
    profiles: cfg.profiles,
    tool,
    postResponse: (sessionId, content, opts) =>
      client.postResponse({ sessionId, content, final: opts?.final ?? true }).then(() => undefined),
    log,
    maxConcurrency: cfg.maxConcurrency
  });
  const orch = new Orchestrator({ config: cfg, client, pool, log });
  orch.start();
  log(
    `running — heartbeat ${cfg.heartbeatIntervalMs}ms poll ${cfg.pollIntervalMs}ms — profiles: ${pool.runnerNames().join(", ")}`
  );

  const stop = async (sig: string): Promise<void> => {
    log(`${sig} — stopping`);
    await orch.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

async function main(): Promise<void> {
  const cmd = normalizeCommand(process.argv[2]);

  if (cmd === "run") {
    await runDaemon();
    return;
  }

  if (cmd === "--path") {
    process.stdout.write(defaultConfigPath() + "\n");
    return;
  }

  if (cmd === "menu") {
    await showMainMenu();
    return;
  }

  process.stderr.write("usage: chatcoder coder [--daemon|--path]\n");
  process.stderr.write("       default command: menu\n");
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
