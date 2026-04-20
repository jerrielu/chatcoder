import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { AdminSession } from "@chatcoder/shared";
import * as api from "../api/client";
import { HEARTBEAT_STALE_MS } from "../config";
import { usePolling } from "../util/usePolling";
import { HeartbeatBadge, StatusBadge, Timestamp } from "../util/badges";

const DEFAULT_LIMIT = 50;

function parseFilter(params: URLSearchParams): {
  status?: "active" | "revoked";
  chatId?: number;
  limit: number;
  offset: number;
} {
  const status = params.get("status");
  const chatId = params.get("chatId");
  const limit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  const offset = Number(params.get("offset") ?? 0);
  return {
    ...(status === "active" || status === "revoked" ? { status } : {}),
    ...(chatId ? { chatId: Number(chatId) } : {}),
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0
  };
}

export function SessionsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params);
  const navigate = useNavigate();

  const { data, error, loading, refresh } = usePolling(
    () => api.listSessions(filter),
    15_000,
    [filter.status, filter.chatId, filter.limit, filter.offset]
  );

  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const chatId = Number(fd.get("chatId"));
    const rawApiKey = String(fd.get("rawApiKey") ?? "").trim() || undefined;
    if (!Number.isFinite(chatId)) {
      setCreateError("chatId must be numeric");
      return;
    }
    setCreateError(null);
    try {
      const res = await api.createSession({
        chatId,
        ...(rawApiKey ? { rawApiKey } : {})
      });
      setCreatedKey(res.rawApiKey);
      form.reset();
      refresh();
      navigate(`/sessions/${res.session.id}`, {
        state: { flashKey: res.rawApiKey }
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const updateFilter = (next: Partial<ReturnType<typeof parseFilter>>): void => {
    const merged = { ...filter, ...next };
    const obj: Record<string, string> = {};
    if (merged.status) obj.status = merged.status;
    if (merged.chatId !== undefined) obj.chatId = String(merged.chatId);
    obj.limit = String(merged.limit);
    obj.offset = String(merged.offset);
    setParams(obj);
  };

  return (
    <>
      <h1>Sessions</h1>
      {createdKey && (
        <div className="flash">
          Raw API key (shown once — copy now):{"\n\n"}
          {createdKey}
        </div>
      )}
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
          updateFilter({
            ...(statusVal === "active" || statusVal === "revoked"
              ? { status: statusVal }
              : { status: undefined }),
            ...(chatVal ? { chatId: Number(chatVal) } : { chatId: undefined }),
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
        <button type="submit">Filter</button>
        <Link className="link" to="/sessions">Clear</Link>
      </form>

      <div className="card">
        <h2>Create a session</h2>
        <form className="row" onSubmit={handleCreate}>
          <label>
            Chat ID (numeric):
            <input type="number" name="chatId" required />
          </label>
          <label>
            API key (optional, ≥16 chars):
            <input type="text" name="rawApiKey" minLength={16} />
          </label>
          <button type="submit">Create</button>
          {createError && <span className="muted" style={{ color: "#b73030" }}>{createError}</span>}
        </form>
      </div>

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
            {s.apiKeyPrefix}…
          </Link>
        </td>
        <td>{s.chatId}</td>
        <td><StatusBadge status={s.status} /></td>
        <td>
          <HeartbeatBadge lastHeartbeat={s.lastHeartbeat} now={now} staleMs={HEARTBEAT_STALE_MS} />
        </td>
        <td><Timestamp value={s.createdAt} /></td>
      </tr>
    ))
  ) : (
    <tr>
      <td colSpan={5} className="muted">
        {loading ? "Loading…" : `No sessions match the current filter (${total} total).`}
      </td>
    </tr>
  );

  return (
    <table>
      <thead>
        <tr>
          <th>Key</th>
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
