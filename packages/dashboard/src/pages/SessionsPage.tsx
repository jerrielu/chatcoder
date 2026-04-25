import { Link, useSearchParams } from "react-router-dom";
import type { AdminSession } from "@chatcoder/shared";
import * as api from "../api/client";
import { HEARTBEAT_STALE_MS } from "../config";
import { usePolling } from "../util/usePolling";
import { HeartbeatBadge, StatusBadge, Timestamp } from "../util/badges";

const DEFAULT_LIMIT = 50;

function parseFilter(params: URLSearchParams): {
  status?: "active" | "revoked";
  chatId?: number;
  apiKeyId?: string;
  limit: number;
  offset: number;
} {
  const status = params.get("status");
  const chatId = params.get("chatId");
  const apiKeyId = params.get("apiKeyId") ?? undefined;
  const limit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const offset = Number(params.get("offset") ?? 0);
  return {
    ...(status === "active" || status === "revoked" ? { status } : {}),
    ...(chatId ? { chatId: Number(chatId) } : {}),
    ...(apiKeyId ? { apiKeyId } : {}),
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0
  };
}

export function SessionsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params);

  const { data, error, loading } = usePolling(
    () => api.listSessions(filter),
    15_000,
    [filter.status, filter.chatId, filter.apiKeyId, filter.limit, filter.offset]
  );

  const updateFilter = (next: Partial<ReturnType<typeof parseFilter>>): void => {
    const merged = { ...filter, ...next };
    const obj: Record<string, string> = {};
    if (merged.status) obj.status = merged.status;
    if (merged.chatId !== undefined) obj.chatId = String(merged.chatId);
    if (merged.apiKeyId) obj.apiKeyId = merged.apiKeyId;
    obj.limit = String(merged.limit);
    obj.offset = String(merged.offset);
    setParams(obj);
  };

  return (
    <>
      <h1>Sessions</h1>
      <p className="muted">
        Sessions are created from Telegram — users paste a daemon API key,
        pick a profile, and the bot links their chat to that profile. There
        is no "create session" button here.
      </p>
      {error && !loading && (
        <div className="error-box">
          Failed to load sessions: {error.message}
        </div>
      )}

      <form
        className="card row"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const statusVal = String(fd.get("status") ?? "");
          const chatVal = String(fd.get("chatId") ?? "");
          const apiVal = String(fd.get("apiKeyId") ?? "").trim();
          updateFilter({
            ...(statusVal === "active" || statusVal === "revoked"
              ? { status: statusVal }
              : { status: undefined }),
            ...(chatVal ? { chatId: Number(chatVal) } : { chatId: undefined }),
            ...(apiVal ? { apiKeyId: apiVal } : { apiKeyId: undefined }),
            offset: 0
          });
        }}
      >
        <label>
          Status:
          <select name="status" defaultValue={filter.status ?? ""}>
            <option value="">any</option>
            <option value="active">active</option>
            <option value="revoked">revoked</option>
          </select>
        </label>
        <label>
          Chat ID:
          <input type="number" name="chatId" defaultValue={filter.chatId ?? ""} />
        </label>
        <label>
          API key ID:
          <input type="text" name="apiKeyId" defaultValue={filter.apiKeyId ?? ""} />
        </label>
        <button type="submit">Filter</button>
        <Link className="link" to="/sessions">Clear</Link>
      </form>

      <SessionsTable
        sessions={data?.sessions ?? []}
        total={data?.total ?? 0}
        loading={loading}
      />

      <Pagination
        limit={filter.limit}
        offset={filter.offset}
        total={data?.total ?? 0}
        onGo={(offset) => updateFilter({ offset })}
      />
    </>
  );
}

function SessionsTable({
  sessions,
  total,
  loading
}: {
  sessions: AdminSession[];
  total: number;
  loading: boolean;
}): JSX.Element {
  const now = Date.now();
  const rows = sessions.length ? (
    sessions.map((s) => (
      <tr key={s.id}>
        <td>
          <Link className="link" to={`/sessions/${s.id}`}>
            {s.id.slice(0, 8)}…
          </Link>
        </td>
        <td>
          <code>{s.apiKeyPrefix}…</code>
        </td>
        <td>
          {s.profileName} <span className="muted">({s.profileTool})</span>
        </td>
        <td>{s.chatId}</td>
        <td>
          <StatusBadge status={s.status} />
        </td>
        <td>
          <HeartbeatBadge
            lastHeartbeat={s.apiKeyLastHeartbeat}
            now={now}
            staleMs={HEARTBEAT_STALE_MS}
          />
        </td>
        <td>
          <Timestamp value={s.createdAt} />
        </td>
      </tr>
    ))
  ) : (
    <tr>
      <td colSpan={7} className="muted">
        {loading ? "Loading…" : `No sessions match the current filter (${total} total).`}
      </td>
    </tr>
  );

  return (
    <table>
      <thead>
        <tr>
          <th>Session</th>
          <th>API key</th>
          <th>Profile</th>
          <th>Chat ID</th>
          <th>Status</th>
          <th>Daemon</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

function Pagination({
  limit,
  offset,
  total,
  onGo
}: {
  limit: number;
  offset: number;
  total: number;
  onGo: (offset: number) => void;
}): JSX.Element {
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  return (
    <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
      <span className="muted">
        Showing {total === 0 ? 0 : offset + 1}-{Math.min(offset + limit, total)} of {total}
      </span>
      <div className="actions">
        <button
          type="button"
          className="muted"
          disabled={!hasPrev}
          onClick={() => onGo(prevOffset)}
        >
          ← Prev
        </button>
        <button
          type="button"
          className="muted"
          disabled={!hasNext}
          onClick={() => onGo(nextOffset)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
