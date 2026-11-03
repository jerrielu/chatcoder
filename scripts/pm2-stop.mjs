#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const services = ["chatcoder-chat", "chatcoder-coder"];

function run(args) {
  const result = spawnSync("pm2", args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    process.stderr.write(
      `chatcoder: failed to run pm2 ${args.join(" ")}: ${String(result.error)}\n`
    );
    process.exit(1);
  }
  // pm2 stop/delete return non-zero when a process isn't running; treat as non-fatal.
  if (result.status !== 0 && result.status !== 1) process.exit(result.status ?? 1);
}

const running = (() => {
  const result = spawnSync("pm2", ["jlist"], { cwd: rootDir, encoding: "utf8" });
  if (result.error || result.status !== 0) return new Set();
  try {
    return new Set(JSON.parse(result.stdout).map((p) => p.name));
  } catch {
    return new Set();
  }
})();

for (const name of services) {
  if (running.has(name)) {
    run(["stop", name]);
    run(["delete", name]);
  }
}
run(["save"]);
