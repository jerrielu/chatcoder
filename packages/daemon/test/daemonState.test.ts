import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  clearState,
  isProcessAlive,
  killProcess,
  killProcessTree,
  killRegisteredTools,
  readState,
  registerToolPid,
  unregisterToolPid,
  writeState
} from "../src/daemonState.js";

let stateFile: string;

beforeEach(() => {
  stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cc-daemon-state-")), "state.json");
  process.env.CHATCODER_STATE_FILE = stateFile;
});

afterEach(() => {
  delete process.env.CHATCODER_STATE_FILE;
  clearState();
  fs.rmSync(path.dirname(stateFile), { recursive: true, force: true });
});

function spawnSleeper(): number {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: true // group leader, like production tool children
  });
  return child.pid!;
}

/** Spawn a detached leader that itself spawns a grandchild — mirrors the
 *  two-level tool CLIs (node wrapper → real binary). */
function spawnTree(): { leader: number; getGrandchild: () => number } {
  let grandchild = 0;
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const {spawn}=require('node:child_process');" +
        "const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});" +
        "console.log('GC:'+g.pid);" +
        "setInterval(()=>{},1000)"
    ],
    { stdio: ["ignore", "pipe", "ignore"], detached: true }
  );
  child.stdout.on("data", (d) => {
    const m = /GC:(\d+)/.exec(d.toString());
    if (m) grandchild = Number(m[1]);
  });
  return { leader: child.pid!, getGrandchild: () => grandchild };
}

function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (fn()) {
        clearInterval(t);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(t);
        reject(new Error("condition not met in time"));
      }
    }, 50);
  });
}

describe("daemonState", () => {
  it("writes and reads the registry", () => {
    writeState({ daemonPid: 123, startedAt: 456, toolPids: [1, 2] });
    expect(readState()).toEqual({ daemonPid: 123, startedAt: 456, toolPids: [1, 2] });
  });

  it("returns null when the file is missing or corrupt", () => {
    expect(readState()).toBeNull();
    fs.writeFileSync(stateFile, "not json");
    expect(readState()).toBeNull();
  });

  it("registers and unregisters tool PIDs", () => {
    writeState({ daemonPid: 123, startedAt: 0, toolPids: [] });
    registerToolPid(555);
    expect(readState()?.toolPids).toEqual([555]);
    registerToolPid(555); // idempotent
    expect(readState()?.toolPids).toEqual([555]);
    unregisterToolPid(555);
    expect(readState()?.toolPids).toEqual([]);
  });

  it("isProcessAlive distinguishes live and dead PIDs", () => {
    expect(isProcessAlive(999_999_999)).toBe(false);
    const pid = spawnSleeper();
    expect(isProcessAlive(pid)).toBe(true);
    process.kill(pid, "SIGKILL");
  });

  it("killProcess terminates a live process", async () => {
    const pid = spawnSleeper();
    expect(isProcessAlive(pid)).toBe(true);
    await killProcess(pid);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("killRegisteredTools kills every registered tool process", async () => {
    const pids = [spawnSleeper(), spawnSleeper()];
    writeState({ daemonPid: 123, startedAt: 0, toolPids: pids });
    await killRegisteredTools();
    for (const pid of pids) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  });

  it("killProcessTree kills the whole two-level tree, not just the leader", async () => {
    const { leader, getGrandchild } = spawnTree();
    await waitFor(() => getGrandchild() !== 0 && isProcessAlive(leader));
    const grandchild = getGrandchild();
    expect(isProcessAlive(leader)).toBe(true);
    expect(isProcessAlive(grandchild)).toBe(true);

    await killProcessTree(leader);

    expect(isProcessAlive(leader)).toBe(false);
    // The grandchild must NOT survive its parent's death (the old bug: killing
    // only the direct child orphaned the real tool binary).
    expect(isProcessAlive(grandchild)).toBe(false);
  });

  it("clearState removes the registry file", () => {
    writeState({ daemonPid: 123, startedAt: 0, toolPids: [] });
    clearState();
    expect(readState()).toBeNull();
  });
});
