#!/usr/bin/env node
import * as fs from "node:fs";
import { defaultConfigPath, loadConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { showMainMenu } from "./menu.js";
import { ApiClient } from "./client.js";
import { Orchestrator } from "./orchestrator.js";
import { SessionManager } from "./sessionManager.js";
import { ToolExecutor } from "./toolExecutor.js";
import {
  clearState,
  isProcessAlive,
  killProcess,
  killRegisteredTools,
  readState,
  writeState
} from "./daemonState.js";

/** How often the daemon checks that it is still the only instance. */
const STALE_SWEEP_INTERVAL_MS = 60_000;

/**
 * Kill any daemon from a previous run and the tool processes it left behind,
 * then claim sole ownership of the daemon state. This turns "restart" into a
 * clean handover instead of stacking a second orphaned daemon on top.
 */
async function sweepStaleInstances(log: (m: string, extra?: unknown) => void): Promise<void> {
  // Kill the previous daemon first — its own exit path (old code has none)
  // may still be spawning tool children while it is alive.
  const before = readState();
  if (before && before.daemonPid !== process.pid && isProcessAlive(before.daemonPid)) {
    log(`stale daemon ${before.daemonPid} still running — killing it`);
    await killProcess(before.daemonPid);
  }
  // Now the old daemon is dead, so its registered tool children are stale.
  // Kill them (they were the frozen-progress CPU burners).
  const after = readState();
  if (after) {
    for (const pid of after.toolPids) {
      if (isProcessAlive(pid)) {
        log(`stale tool process ${pid} — killing it`);
        await killProcess(pid);
      }
    }
  }
  // Claim sole ownership.
  writeState({ daemonPid: process.pid, startedAt: Date.now(), toolPids: [] });
}

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

  // "If something is stale, kill it": clean up previous runs before doing
  // anything else so we are guaranteed to be the only daemon instance.
  await sweepStaleInstances(log);

  // Sync fallback for unexpected exits (SIGKILL, crash, process.exit): kill
  // whatever tool children we registered so they can never be orphaned.
  process.on("exit", () => {
    const state = readState();
    if (!state || state.daemonPid !== process.pid) return;
    for (const pid of state.toolPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });

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

  const tool = new ToolExecutor({ log, stallTimeoutMs: cfg.stallTimeoutMs });
  const sessionManager = new SessionManager({
    config: cfg,
    tool,
    postResponse: (sessionId, content, opts) =>
      client.postResponse({ sessionId, content, final: opts?.final ?? true }).then(() => undefined),
    log,
    maxConcurrency: cfg.maxConcurrency
  });
  const orch = new Orchestrator({ config: cfg, client, sessionManager, log });
  orch.start();
  log(
    `running — heartbeat ${cfg.heartbeatIntervalMs}ms poll ${cfg.pollIntervalMs}ms`
  );

  // Periodic self-check: if another daemon has taken over the registry (e.g.
  // we lost a startup race), we are the stale one — clean up and exit.
  // Also prunes dead tool PIDs from the registry.
  const sweepTimer = setInterval(() => {
    void (async () => {
      const state = readState();
      if (!state) return;
      if (state.daemonPid !== process.pid && isProcessAlive(state.daemonPid)) {
        // Another daemon owns the registry — we are the stale one. Its startup
        // sweep already killed our registered children, so just exit and leave
        // its state file alone (clearing it would let a third daemon take over
        // and kill the current one).
        log(`superseded by daemon ${state.daemonPid} — exiting`);
        process.exit(0);
      }
      if (state.daemonPid !== process.pid) return;
      const alive = state.toolPids.filter(isProcessAlive);
      if (alive.length !== state.toolPids.length) {
        writeState({ ...state, toolPids: alive });
      }
    })().catch((err) => log("stale sweep failed", { err }));
  }, STALE_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();

  const stop = async (sig: string): Promise<void> => {
    log(`${sig} — stopping`);
    await orch.stop();
    await killRegisteredTools();
    clearState();
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
