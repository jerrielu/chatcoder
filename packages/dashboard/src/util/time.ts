export function fmtTs(epochMs: number | null | undefined): string {
  if (epochMs == null) return "—";
  return new Date(epochMs).toISOString().replace("T", " ").replace(/\..+$/, "Z");
}

export function fmtAge(ms: number): string {
  if (ms < 1_000) return "0s";
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export type HeartbeatState = "online" | "offline" | "never";

export function heartbeatState(
  lastHeartbeat: number | null,
  now: number,
  staleMs: number
): HeartbeatState {
  if (lastHeartbeat == null) return "never";
  return now - lastHeartbeat < staleMs ? "online" : "offline";
}
