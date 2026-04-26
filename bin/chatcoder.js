#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");

function usage(exitCode = 0) {
  process.stdout.write(
    "usage: chatcoder <chat|coder> [options]\n" +
      "\n" +
      "commands:\n" +
      "  chat                 run the Chat API service\n" +
      "  coder                run the coder daemon service\n" +
      "\n" +
      "options:\n" +
      "  --systemd            install and start a per-user systemd service for the command\n" +
      "  -h, --help           show this help\n"
  );
  process.exit(exitCode);
}

function runNode(entryRelativePath, args) {
  const entryPath = path.join(rootDir, entryRelativePath);
  const result = spawnSync(process.execPath, [entryPath, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    process.stderr.write(`chatcoder: failed to execute ${entryRelativePath}: ${String(result.error)}\n`);
    process.exit(1);
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.status ?? 1);
}

function runSystemctl(args) {
  return spawnSync("systemctl", ["--user", ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });
}

function installSystemdService(serviceBaseName) {
  const unitName = `chatcoder-${serviceBaseName}.service`;
  const unitDir = path.join(os.homedir(), ".config", "systemd", "user");
  const unitPath = path.join(unitDir, unitName);
  const node = process.execPath;
  const command = path.join(rootDir, "bin", "chatcoder.js");
  const now = new Date().toISOString();

  fs.mkdirSync(unitDir, { recursive: true });
  const contents =
    `[Unit]
Description=Chatcoder ${serviceBaseName} service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${process.cwd()}
ExecStart=${node} ${command} ${serviceBaseName}
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
  fs.writeFileSync(unitPath, contents, "utf8");

  const reload = runSystemctl(["daemon-reload"]);
  if (reload.status !== 0 || reload.error) {
    process.stderr.write(
      `chatcoder: wrote ${unitPath} but failed to run systemctl --user daemon-reload.\n` +
        "You may need an active user systemd session.\n"
    );
    process.exit(reload.status ?? 1);
  }

  const enable = runSystemctl(["enable", "--now", unitName]);
  if (enable.status !== 0 || enable.error) {
    process.stderr.write(
      `chatcoder: service file written to ${unitPath} but enable/start failed.\n` +
        `Try: systemctl --user enable --now ${unitName}\n`
    );
    process.exit(enable.status ?? 1);
  }

  process.stdout.write(
    `Installed and started ${unitName}.\n` +
      `Unit file: ${unitPath}\n` +
      `Created at: ${now}\n` +
      `View logs: journalctl --user -u ${unitName} -f\n`
  );
}

function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "-h" || command === "--help") {
    usage(command ? 0 : 1);
  }

  const wantsSystemd = rest.includes("--systemd");
  const forwardedArgs = rest.filter((arg) => arg !== "--systemd");

  if (command === "chat") {
    if (wantsSystemd) {
      installSystemdService("chat");
      return;
    }
    runNode("packages/bot/dist/main.js", forwardedArgs);
    return;
  }

  if (command === "coder") {
    if (wantsSystemd) {
      installSystemdService("coder");
      return;
    }

    let daemonArgs;
    if (forwardedArgs.length === 0) {
      daemonArgs = ["run"];
    } else if (forwardedArgs[0] === "--setup") {
      daemonArgs = ["setup", ...forwardedArgs.slice(1)];
    } else {
      daemonArgs = forwardedArgs;
    }

    runNode("packages/daemon/dist/main.js", daemonArgs);
    return;
  }

  usage(1);
}

main();
