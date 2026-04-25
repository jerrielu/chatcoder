#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const packageRoot = process.cwd();
const workspaceRoot = path.resolve(packageRoot, "../..");
const entry = process.argv[2] ?? "dist/main.js";
const watchRoots = [
  path.join(packageRoot, "src"),
  path.join(packageRoot, "package.json"),
  path.join(packageRoot, "tsconfig.json"),
  path.join(workspaceRoot, "packages/shared/src"),
  path.join(workspaceRoot, "packages/shared/package.json"),
  path.join(workspaceRoot, "packages/shared/tsconfig.json"),
  path.join(workspaceRoot, "tsconfig.base.json"),
];

let app = null;
let building = false;
let pending = false;
let shuttingDown = false;
let debounce = null;
let poller = null;
let snapshot = new Map();
let scanning = false;

const log = (message) => {
  console.log(`[dev] ${message}`);
};

const run = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

const build = async () => {
  log("building");
  const { code } = await run("npm", ["run", "build"]);
  return code === 0;
};

const stopApp = async () => {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const child = app;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
};

const startApp = () => {
  log(`starting ${entry}`);
  app = spawn("node", [entry, ...process.argv.slice(3)], {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  app.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0 && signal === null) {
      log(`process exited with code ${code}; waiting for changes`);
    }
  });
};

const rebuildAndRestart = async () => {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  pending = false;
  await stopApp();
  if (await build()) startApp();
  else log("build failed; waiting for changes");
  building = false;
  if (pending && !shuttingDown) void rebuildAndRestart();
};

const shouldWatch = (filePath) => {
  const base = path.basename(filePath);
  return (
    base !== "node_modules" &&
    base !== "dist" &&
    base !== "coverage" &&
    !base.startsWith(".")
  );
};

const scanPath = async (target, next) => {
  let info;
  try {
    info = await stat(target);
  } catch {
    return;
  }

  if (info.isDirectory()) {
    if (!shouldWatch(target)) return;
    let entries;
    try {
      entries = await readdir(target);
    } catch {
      return;
    }
    for (const entryName of entries) {
      await scanPath(path.join(target, entryName), next);
    }
  } else {
    next.set(target, `${info.mtimeMs}:${info.size}`);
  }
};

const scan = async () => {
  const next = new Map();
  for (const root of watchRoots) {
    await scanPath(root, next);
  }
  return next;
};

const changedSince = (previous, next) => {
  if (previous.size !== next.size) return true;
  for (const [filePath, stamp] of next) {
    if (previous.get(filePath) !== stamp) return true;
  }
  return false;
};

function schedule() {
  if (shuttingDown) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    void rebuildAndRestart();
  }, 150);
}

const shutdown = async () => {
  shuttingDown = true;
  clearTimeout(debounce);
  clearInterval(poller);
  await stopApp();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

snapshot = await scan();
poller = setInterval(async () => {
  if (scanning) return;
  scanning = true;
  try {
    const next = await scan();
    if (changedSince(snapshot, next)) {
      snapshot = next;
      schedule();
    }
  } finally {
    scanning = false;
  }
}, 500);

void rebuildAndRestart();
