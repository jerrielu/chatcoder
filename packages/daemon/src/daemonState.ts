import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Single-instance registry for the daemon and its tool children.
 *
 * Orphaned processes were the root cause of frozen progress messages: every
 * restart started a new daemon but never killed the old one, and the tool
 * children survived their dead parent, burning CPU forever. This file is the
 * source of truth for "who is the current daemon and which tool processes
 * belong to it", so a fresh daemon can kill everything stale on startup and
 * a dying daemon can clean up after itself.
 *
 * Layout: `~/.chatcoder/daemon-state.json`
 *   { "daemonPid": 1234, "startedAt": 178601..., "toolPids": [5678, 9012] }
 */
export interface DaemonState {
  daemonPid: number;
  startedAt: number;
  toolPids: number[];
}

export function stateFilePath(): string {
  return (
    process.env.CHATCODER_STATE_FILE ??
    path.join(os.homedir(), ".chatcoder", "daemon-state.json")
  );
}

export function readState(): DaemonState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath(), "utf8")) as Partial<DaemonState>;
    if (typeof parsed.daemonPid !== "number" || !Array.isArray(parsed.toolPids)) return null;
    return {
      daemonPid: parsed.daemonPid,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now(),
      toolPids: parsed.toolPids.filter((p): p is number => typeof p === "number")
    };
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) so a crash can never leave a half-written file. */
export function writeState(state: DaemonState): void {
  fs.mkdirSync(path.dirname(stateFilePath()), { recursive: true });
  const tmp = `${stateFilePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFilePath());
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** SIGTERM, then SIGKILL after a grace period if it is still alive. */
export async function killProcess(pid: number, graceMs = 2_000): Promise<void> {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/**
 * Kill a tool process AND its descendants by process group. Tool children are
 * spawned `detached` (group leader = child PID), and tool CLIs are two-level
 * (a node wrapper that spawns the real binary) — killing just the direct child
 * orphans the binary, which is how frozen tasks kept running after restarts.
 * `kill(-pid)` reaches every member of the group. Safe only for PIDs we
 * spawned detached, i.e. registered tool PIDs.
 */
export async function killProcessTree(pid: number, graceMs = 2_000): Promise<void> {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Group already gone.
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isProcessAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

/** Kill every tool process (and its descendants) recorded in the registry. */
export async function killRegisteredTools(graceMs = 2_000): Promise<void> {
  const state = readState();
  if (!state) return;
  await Promise.all(state.toolPids.map((pid) => killProcessTree(pid, graceMs)));
}

export function registerToolPid(pid: number): void {
  const state = readState() ?? { daemonPid: process.pid, startedAt: Date.now(), toolPids: [] };
  if (!state.toolPids.includes(pid)) {
    state.toolPids.push(pid);
    writeState(state);
  }
}

export function unregisterToolPid(pid: number): void {
  const state = readState();
  if (!state) return;
  const next = state.toolPids.filter((p) => p !== pid);
  if (next.length !== state.toolPids.length) {
    writeState({ ...state, toolPids: next });
  }
}

export function clearState(): void {
  try {
    fs.unlinkSync(stateFilePath());
  } catch {
    // Nothing to clear.
  }
}
