#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(rootDir, "bin", "chatcoder.js");

// Release mode: run both services from the built dist artifacts.
const services = [
  { name: "chat", args: ["chat"] },
  { name: "coder", args: ["coder", "--daemon"] },
];

const children = services.map(({ name, args }) => {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (err) => {
    process.stderr.write(`[${name}] failed to start: ${String(err)}\n`);
  });

  child.on("exit", (code, signal) => {
    process.stderr.write(
      `[${name}] exited (${signal ? `signal ${signal}` : `code ${code}`})\n`
    );
  });

  return child;
});

const forward = (sig) => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill(sig);
      } catch {
        // Already gone.
      }
    }
  }
};

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
