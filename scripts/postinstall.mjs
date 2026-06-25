#!/usr/bin/env node
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
  const installDir = process.cwd();
  debug(`postinstall: cwd=${installDir}`);

  // Check if the install is broken (key files missing)
  const essential = ["package.json", "bin/chatcoder.js"];
  const hasEssential = essential.every((f) => existsSync(path.join(installDir, f)));

  if (hasEssential) {
    debug("postinstall: install OK");
    return;
  }

  debug("postinstall: install broken, attempting self-heal");

  // Determine tarball URL from package.json (if it exists) or default
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
    process.exit(1);
  }

  const tar = spawnSync("tar", ["-xzf", "-", "--strip-components=1"], {
    cwd: installDir,
    input: Buffer.from(await response.arrayBuffer()),
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (tar.status !== 0) {
    debug(`postinstall: extraction failed (code ${tar.status})`);
    process.exit(1);
  }

  debug("postinstall: self-heal complete");
}

main().catch((err) => {
  debug(`postinstall: error: ${err.stack || err}`);
  process.exit(1);
});
