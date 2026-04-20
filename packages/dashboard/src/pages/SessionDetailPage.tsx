import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { AdminMessage, AdminSession } from "@chatcoder/shared";
import { MAX_INSTRUCTION_BYTES, MAX_RESPONSE_BYTES } from "@chatcoder/shared";
import * as api from "../api/client";
import { HEARTBEAT_STALE_MS } from "../config";
import { usePolling } from "../util/usePolling";
import { HeartbeatBadge, StatusBadge, Timestamp } from "../util/badges";

export function SessionDetailPage(): JSX.Element {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as { flashKey?: string } | null | undefined;

  const [flash, setFlash] = useState<{ kind: "key" | "info"; text: string } | null>(() =>
    locationState?.flashKey ? { kind: "key", text: locationState.flashKey } : null
  );

  // Clear router state so a browser refresh doesn't re-display the secret.
  useEffect(() => {
    if (locationState?.flashKey) {
      window.history.replaceState({}, "", location.pathname + location.search);
    }
  }, [location.pathname, location.search, locationState]);

  const { data, error, loading, refresh } = usePolling(
    () => api.getSessionDetail(id),
    10_000,
    [id]
  );

  const flashInfo = useCallback((text: string) => setFlash({ kind: "info", text }), []);
  const flashKey = useCallback((text: string) => setFlash({ kind: "key", text }), []);

  if (loading && !data) return <p className="muted">Loading…</p>;
  if (error && !data) {
    return (
      <>
        <Link className="link" to="/sessions">← All sessions</Link>
        <div className="error-box">Failed to load session: {error.message}</div>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <h1>Session not found</h1>
        <Link className="link" to="/sessions">← All sessions</Link>
      </>
    );
  }

  const session = data.session;

  return (
    <>
      <Link className="link" to="/sessions">← All sessions</Link>
      <h1>Session {session.apiKeyPrefix}…</h1>

      {flash && (
        <div className="flash">
          {flash.kind === "key"
            ? `Raw API key (shown once — copy now):\n\n${flash.text}`
            : flash.text}
        </div>
      )}

      <SessionInfoCard
        session={session}
        pendingToDaemon={data.pendingToDaemon}
        pendingToUser={data.pendingToUser}
        onUpdate={async (chatId) => {
          const ok = await api.updateSession(session.id, { chatId });
          if (ok) {
            flashInfo("Session updated.");
            refresh();
          }
        }}
      />

      <SessionActions
        sessionId={session.id}
        onRotated={(key) => {
          flashKey(key);
          refresh();
        }}
        onRevoked={() => {
          flashInfo("Session revoked.");
          refresh();
        }}
        onPurged={() => {
          flashInfo("All messages purged.");
          refresh();
        }}
        onDeleted={() => navigate("/sessions")}
      />

      <h2>Messages</h2>
      <EnqueueForm
        sessionId={session.id}
        onEnqueued={() => {
          flashInfo("Message enqueued.");
          refresh();
        }}
      />
      <MessagesTable
        sessionId={session.id}
        messages={data.messages}
        onChanged={() => refresh()}
      />
    </>
  );
}

function SessionInfoCard({
  session,
  pendingToDaemon,
  pendingToUser,
  onUpdate
}: {
  session: AdminSession;
  pendingToDaemon: number;
  pendingToUser: number;
  onUpdate: (chatId: number) => Promise<void>;
}): JSX.Element {
  const [chatIdInput, setChatIdInput] = useState(String(session.chatId));
  const now = Date.now();
  return (
    <div className="card">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const n = Number(chatIdInput);
          if (!Number.isFinite(n)) return;
          await onUpdate(n);
        }}
      >
        <table>
          <tbody>
            <tr><th>ID</th><td><code>{session.id}</code></td></tr>
            <tr>
              <th>Chat ID</th>
              <td>
                <input
                  type="number"
                  value={chatIdInput}
                  onChange={(e) => setChatIdInput(e.target.value)}
                  required
                />{" "}
                <button type="submit">Update</button>
              </td>
            </tr>
            <tr><th>Status</th><td><StatusBadge status={session.status} /></td></tr>
            <tr><th>Created</th><td><Timestamp value={session.createdAt} /></td></tr>
            <tr><th>Revoked</th><td><Timestamp value={session.revokedAt} /></td></tr>
            <tr>
              <th>Last heartbeat</th>
              <td>
                <HeartbeatBadge
                  lastHeartbeat={session.lastHeartbeat}
                  now={now}
                  staleMs={HEARTBEAT_STALE_MS}
                />
                <br />
                <Timestamp value={session.lastHeartbeat} />
              </td>
            </tr>
            <tr><th>Pending → daemon</th><td>{pendingToDaemon}</td></tr>
            <tr><th>Pending → user</th><td>{pendingToUser}</td></tr>
          </tbody>
        </table>
      </form>
    </div>
  );
}

function SessionActions({
  sessionId,
  onRotated,
  onRevoked,
  onPurged,
  onDeleted
}: {
  sessionId: string;
  onRotated: (rawApiKey: string) => void;
  onRevoked: () => void;
  onPurged: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const [rotateKey, setRotateKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const doRotate = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy("rotate");
    try {
      const res = await api.rotateSession(sessionId, {
        ...(rotateKey.trim() ? { rawApiKey: rotateKey.trim() } : {})
      });
      if (res) {
        setRotateKey("");
        onRotated(res.rawApiKey);
      }
    } finally {
      setBusy(null);
    }
  };

  const doRevoke = async (): Promise<void> => {
    if (!confirm("Revoke this session? The daemon will be cut off.")) return;
    setBusy("revoke");
    try {
      if (await api.revokeSession(sessionId)) onRevoked();
    } finally {
      setBusy(null);
    }
  };

  const doPurge = async (): Promise<void> => {
    if (!confirm("Purge ALL messages for this session?")) return;
    setBusy("purge");
    try {
      if (await api.purgeSession(sessionId)) onPurged();
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (): Promise<void> => {
    if (!confirm("Delete this session and all its messages?")) return;
    setBusy("delete");
    try {
      if (await api.deleteSession(sessionId)) onDeleted();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card row">
      <form className="row" onSubmit={doRotate}>
        <input
          type="text"
          placeholder="Optional new key"
          minLength={16}
          value={rotateKey}
          onChange={(e) => setRotateKey(e.target.value)}
        />
        <button type="submit" disabled={busy === "rotate"}>
          Rotate key
        </button>
      </form>
      <button className="muted" type="button" onClick={doRevoke} disabled={busy === "revoke"}>
        Revoke
      </button>
      <button className="muted" type="button" onClick={doPurge} disabled={busy === "purge"}>
        Purge messages
      </button>
      <button className="danger" type="button" onClick={doDelete} disabled={busy === "delete"}>
        Delete
      </button>
    </div>
  );
}

function EnqueueForm({
  sessionId,
  onEnqueued
}: {
  sessionId: string;
  onEnqueued: () => void;
}): JSX.Element {
  const [direction, setDirection] = useState<AdminMessage["direction"]>("to_daemon");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const limit = direction === "to_daemon" ? MAX_INSTRUCTION_BYTES : MAX_RESPONSE_BYTES;

  return (
    <form
      className="card row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!content) return;
        if (content.length > limit) {
          setError(`content exceeds ${limit} bytes for ${direction}`);
          return;
        }
        setError(null);
        try {
          const res = await api.enqueueMessage(sessionId, { direction, content });
          if (res) {
            setContent("");
            onEnqueued();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
        <option value="to_daemon">to_daemon (instruction)</option>
        <option value="to_user">to_user (response)</option>
      </select>
      <textarea
        required
        maxLength={limit}
        placeholder="Message content (capped per direction)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button type="submit">Enqueue</button>
      {error && <span style={{ color: "#b73030" }}>{error}</span>}
    </form>
  );
}

function MessagesTable({
  sessionId,
  messages,
  onChanged
}: {
  sessionId: string;
  messages: AdminMessage[];
  onChanged: () => void;
}): JSX.Element {
  if (!messages.length) {
    return (
      <table>
        <thead>
          <tr><th>Direction</th><th>Created</th><th>Content</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr><td colSpan={4} className="muted">No messages yet.</td></tr>
        </tbody>
      </table>
    );
  }
  return (
    <table>
      <thead>
        <tr><th>Direction</th><th>Created</th><th>Content</th><th>Actions</th></tr>
      </thead>
      <tbody>
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            sessionId={sessionId}
            message={m}
            onChanged={onChanged}
          />
        ))}
      </tbody>
    </table>
  );
}

function MessageRow({
  sessionId,
  message,
  onChanged
}: {
  sessionId: string;
  message: AdminMessage;
  onChanged: () => void;
}): JSX.Element {
  void sessionId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [error, setError] = useState<string | null>(null);
  const limit =
    message.direction === "to_daemon" ? MAX_INSTRUCTION_BYTES : MAX_RESPONSE_BYTES;

  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (draft.length > limit) {
                setError(`content exceeds ${limit} bytes`);
                return;
              }
              try {
                const ok = await api.updateMessage(message.id, { content: draft });
                if (ok) {
                  setEditing(false);
                  onChanged();
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <textarea
              required
              maxLength={limit}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="actions">
              <button type="submit">Save</button>
              <button
                type="button"
                className="muted"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
            {error && <span style={{ color: "#b73030" }}>{error}</span>}
          </form>
        </td>
      </tr>
    );
  }

  const dirLabel = message.direction === "to_daemon" ? "→ daemon" : "→ user";
  const dirClass = message.direction === "to_daemon" ? "ok" : "muted";

  return (
    <tr>
      <td><span className={`badge ${dirClass}`}>{dirLabel}</span></td>
      <td><Timestamp value={message.createdAt} /></td>
      <td><pre>{message.content}</pre></td>
      <td>
        <div className="actions">
          <button type="button" className="muted" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!confirm("Delete this message?")) return;
              if (await api.deleteMessage(message.id)) onChanged();
            }}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
