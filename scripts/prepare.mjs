#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
/*  Self-heal: download tarball when npm 10.x pacote extracts empty dirs     */
/* -------------------------------------------------------------------------- */

const ESSENTIAL_FILES = ["package.json", "bin/chatcoder.js"];

/** Check if the install is broken (npm 10.x pacote bug: empty directories). */
function isBrokenExtraction() {
  try {
    const items = readdirSync(rootDir);
    if (items.length === 0) return true;
    // If even the root package.json is missing, extraction is incomplete.
    return !ESSENTIAL_FILES.every((f) => existsSync(path.join(rootDir, f)));
  } catch {
    return true;
  }
}

async function selfHeal() {
  const pkgJson = JSON.parse(
    await readFile(path.join(rootDir, "package.json"), "utf8")
  );

  // Determine the tarball URL from repository info or a sensible default.
  const rawRepo =
    typeof pkgJson.repository === "object"
      ? pkgJson.repository.url
      : pkgJson.repository;
  const repoUrl = rawRepo || "https://github.com/jerrielu/chatcoder";
  // Convert various git URL formats to codeload tarball URL.
  const tarballUrl = repoUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^github:/, "https://github.com/")
    .replace(
      /^https?:\/\/(?:www\.)?github\.com\//,
      "https://codeload.github.com/"
    )
    .replace(/\/?$/, "/tar.gz/HEAD");

  process.stdout.write(
    `chatcoder: npm 10.x extraction bug detected, re-extracting from ${tarballUrl}\n`
  );

  // Download tarball.
  const url = new URL(tarballUrl);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    process.stderr.write(
      `chatcoder: failed to download tarball (HTTP ${response.status})\n`
    );
    process.exit(1);
  }

  // Extract tarball using tar (npm's bundled tar works on all platforms).
  const tar = spawnSync("tar", ["-xzf", "-", "--strip-components=1"], {
    cwd: rootDir,
    input: Buffer.from(await response.arrayBuffer()),
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (tar.status !== 0) {
    process.stderr.write(
      `chatcoder: tarball extraction failed (code ${tar.status})\n`
    );
    process.exit(1);
  }

  process.stdout.write("chatcoder: self-heal complete.\n");
}

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

const isGlobalInstall = process.env.npm_config_global === "true";

// When installed via `npm install -g github:jerrielu/chatcoder`, npm 10.x
// may extract empty directories only (pacote bug). Detect and self-heal.
if (isBrokenExtraction()) {
  await selfHeal();
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
