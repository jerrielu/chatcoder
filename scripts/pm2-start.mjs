#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(rootDir, "bin", "chatcoder.js");

// Start (or restart) both services as PM2 processes, launched from the
// repo-local CLI so they run the release build in packages/*/dist.
const services = [
  { name: "chatcoder-chat", args: ["chat"] },
  { name: "chatcoder-coder", args: ["coder", "--daemon"] },
];

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
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function existingNames() {
  const result = spawnSync("pm2", ["jlist"], { cwd: rootDir, encoding: "utf8" });
  if (result.error || result.status !== 0) return new Set();
  try {
    return new Set(JSON.parse(result.stdout).map((p) => p.name));
  } catch {
    return new Set();
  }
}

const running = existingNames();
for (const { name, args } of services) {
  if (running.has(name)) {
    run(["restart", name]);
  } else {
    run(["start", cliPath, "--name", name, "--", ...args]);
  }
}
run(["save"]);
