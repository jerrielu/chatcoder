#!/usr/bin/env node
import { appendFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(thisFile), "..");

const DEBUG_LOG = "/tmp/chatcoder-postinstall-debug.log";
function debug(msg) {
  try {
    appendFileSync(DEBUG_LOG, new Date().toISOString() + " " + msg + "\n");
  } catch { /* ignore */ }
}

async function main() {
  // process.cwd() may be invalid if npm cleaned up the cache tmp dir.
  // Use the script's own location (content store) to find essential files.
  debug(`postinstall: rootDir=${rootDir}`);
  debug(`postinstall: cwd attempt...`);
  try {
    debug(`postinstall: cwd=${process.cwd()}`);
  } catch {
    debug("postinstall: cwd is invalid (cache dir removed)");
  }

  // Check if the install is broken by looking for bin/chatcoder.js.
  // During npm's postinstall for git deps, the package root is the script
  // dir (content store), not the cache tmp dir.
  const installDir = rootDir;
  const essential = ["package.json", "bin/chatcoder.js"];
  const hasEssential = essential.every((f) => existsSync(path.join(installDir, f)));

  if (hasEssential) {
    debug("postinstall: install OK");
    return;
  }

  debug("postinstall: install broken, attempting self-heal");

  // Determine tarball URL from package.json or default.
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

  debug(`postinstall: downloading from ${tarballUrl}`);

  const response = await fetch(tarballUrl);
  if (!response.ok || !response.body) {
    debug(`postinstall: download failed (HTTP ${response.status})`);
    return;
  }

  const tar = spawnSync("tar", ["-xzf", "-", "--strip-components=1"], {
    cwd: installDir,
    input: Buffer.from(await response.arrayBuffer()),
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (tar.status !== 0) {
    debug(`postinstall: extraction failed (code ${tar.status})`);
    return;
  }

  debug("postinstall: self-heal complete");
}

main().catch((err) => {
  debug(`postinstall: error: ${err.stack || err}`);
});
