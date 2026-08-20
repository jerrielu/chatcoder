#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
/*  Self-heal: npm 10.x/11.x pacote bug — re-extract tarball                 */
/* -------------------------------------------------------------------------- */

const ESSENTIAL_FILES = ["package.json", "bin/chatcoder.js"];

function isBrokenExtraction(dir) {
  try {
    const items = readdirSync(dir);
    if (items.length === 0) return true;
    return !ESSENTIAL_FILES.every((f) => existsSync(path.join(dir, f)));
  } catch {
    return true;
  }
}

async function selfHeal(installDir) {
  // Determine tarball URL.
  let repoUrl = "https://github.com/jerrielu/chatcoder";
  const pkgPath = path.join(installDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      const raw = typeof pkg.repository === "object" ? pkg.repository.url : pkg.repository;
      if (raw) repoUrl = raw;
    } catch { /* ignore */ }
  }

  const tarballUrl = repoUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/")
    .replace(/^https?:\/\/(?:www\.)?github\.com\//, "https://codeload.github.com/")
    .replace(/\/?$/, "/tar.gz/HEAD");

  process.stdout.write(`chatcoder: re-extracting from ${tarballUrl}\n`);

  const response = await fetch(tarballUrl);
  if (!response.ok || !response.body) {
    process.stderr.write(`chatcoder: download failed (HTTP ${response.status})\n`);
    return;
  }

  const data = Buffer.from(await response.arrayBuffer());

  // Extract to the cache tmp dir (npm reify will clean this up).
  const tar1 = spawnSync("tar", ["-xzf", "-", "--strip-components=1"], {
    cwd: installDir,
    input: data,
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (tar1.status !== 0) {
    process.stderr.write(`chatcoder: cache extraction failed (code ${tar1.status})\n`);
  }

  // Also extract to the global install dir so the final install is complete.
  // npm cleans up the cache after prepare, but the global dir survives.
  const npmPrefix = process.env.npm_config_prefix;
  if (npmPrefix) {
    const globalDir = path.join(npmPrefix, "lib", "node_modules", "chatcoder");
    process.stdout.write(`chatcoder: also extracting to ${globalDir}\n`);
    const tar2 = spawnSync("tar", ["-xzf", "-", "--strip-components=1"], {
      cwd: globalDir,
      input: data,
      stdio: ["pipe", "inherit", "inherit"]
    });
    if (tar2.status !== 0) {
      process.stderr.write(`chatcoder: global extraction failed (code ${tar2.status})\n`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

const isGlobalInstall = process.env.npm_config_global === "true";
const installDir = process.cwd();

// npm 10.x/11.x has a bug where git dep extraction is incomplete during
// reify. The prepare script triggers full extraction — if it's still broken,
// download the tarball directly.
if (isBrokenExtraction(installDir)) {
  await selfHeal(installDir);
}

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
