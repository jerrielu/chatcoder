#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(thisFile), "..");

const prebuiltEntries = [
  "packages/shared/dist/index.js",
  "packages/bot/dist/main.js",
  "packages/daemon/dist/main.js"
];

function hasAllPrebuiltArtifacts() {
  return prebuiltEntries.every((entry) => existsSync(path.join(rootDir, entry)));
}

function runBuildRuntime() {
  const result = spawnSync("npm", ["run", "build:runtime"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    process.stderr.write(`chatcoder: failed to start build:runtime: ${String(result.error)}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const isGlobalInstall = process.env.npm_config_global === "true";

if (isGlobalInstall) {
  if (!hasAllPrebuiltArtifacts()) {
    process.stderr.write(
      "chatcoder: global install detected but prebuilt dist artifacts are missing. " +
        "Run `npm run build:runtime` and commit dist outputs before publishing.\n"
    );
    process.exit(1);
  }

  process.stdout.write("chatcoder: global install detected, using prebuilt dist artifacts.\n");
  process.exit(0);
}

runBuildRuntime();
