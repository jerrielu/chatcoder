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

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

const isGlobalInstall = process.env.npm_config_global === "true";

if (isGlobalInstall) {
  // Global installs must ship the prebuilt dist artifacts (the release is
  // produced via `npm run pack:release`, which builds then packs). We never
  // compile here because the build toolchain is a devDependency.
  if (!hasAllPrebuiltArtifacts()) {
    process.stderr.write(
      "chatcoder: global install detected but prebuilt dist artifacts are missing. " +
        "Run `npm run pack:release` from a checkout and install the resulting tarball " +
        "(npm install -g /tmp/chatcoder-<version>.tgz) instead of installing from source.\n"
    );
    process.exit(1);
  }

  process.stdout.write("chatcoder: global install detected, using prebuilt dist artifacts.\n");
  process.exit(0);
}

// Local / development install (or `npm pack` from a checkout).
//
// The committed dist artifacts are the release build. If they are already
// present, leave them untouched so `npm pack` works without a toolchain.
// Only build when they are missing (e.g. a fresh checkout that predates a
// committed build), which requires the dev dependencies to be installed.
if (!hasAllPrebuiltArtifacts()) {
  runBuildRuntime();
}
