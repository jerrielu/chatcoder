import type { AdminSession } from "@chatcoder/shared";
import { fmtAge, fmtTs, heartbeatState } from "./time";

export function StatusBadge({ status }: { status: AdminSession["status"] }): JSX.Element {
  return status === "active" ? (
    <span className="badge ok">active</span>
  ) : (
    <span className="badge bad">revoked</span>
  );
}

export function HeartbeatBadge({
  lastHeartbeat,
  now,
  staleMs
}: {
  lastHeartbeat: number | null;
  now: number;
  staleMs: number;
}): JSX.Element {
  const state = heartbeatState(lastHeartbeat, now, staleMs);
  if (state === "never") return <span className="badge bad">never</span>;
  const age = fmtAge(now - (lastHeartbeat as number));
  if (state === "offline")
    return <span className="badge bad">offline · {age} ago</span>;
  return <span className="badge ok">online · {age} ago</span>;
}

export function Timestamp({ value }: { value: number | null | undefined }): JSX.Element {
  return <span className="muted">{fmtTs(value)}</span>;
}
