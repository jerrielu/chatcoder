import { FormEvent, useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AdminMessage, AdminSession } from "@chatcoder/shared";
import { MAX_INSTRUCTION_BYTES } from "@chatcoder/shared";
import * as api from "../api/client";
import { HEARTBEAT_STALE_MS } from "../config";
import { usePolling } from "../util/usePolling";
import { HeartbeatBadge, StatusBadge, Timestamp } from "../util/badges";

export function SessionDetailPage(): JSX.Element {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [flash, setFlash] = useState<string | null>(null);

  const { data, error, loading, refresh } = usePolling(
    () => api.getSessionDetail(id),
    10_000,
    [id]
  );

  const flashInfo = useCallback((text: string) => setFlash(text), []);

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
      <h1>
        Session {session.id.slice(0, 8)}… ·{" "}
        <span className="muted">{session.profileName}</span>
      </h1>

      {flash && <div className="flash">{flash}</div>}

      <SessionInfoCard session={session} pending={data.pending} />

      <SessionActions
        sessionId={session.id}
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
  pending
}: {
  session: AdminSession;
  pending: number;
}): JSX.Element {
  const now = Date.now();
  return (
    <div className="card">
      <table>
        <tbody>
          <tr>
            <th>ID</th>
            <td>
              <code>{session.id}</code>
            </td>
          </tr>
          <tr>
            <th>Chat ID</th>
            <td>{session.chatId}</td>
          </tr>
          <tr>
            <th>API key</th>
            <td>
              <code>{session.apiKeyPrefix}…</code> ({session.apiKeyId.slice(0, 8)})
            </td>
          </tr>
          <tr>
            <th>Profile</th>
            <td>
              <strong>{session.profileName}</strong>{" "}
              <span className="muted">({session.profileTool})</span>
            </td>
          </tr>
          <tr>
            <th>Status</th>
            <td>
              <StatusBadge status={session.status} />
            </td>
          </tr>
          <tr>
            <th>Created</th>
            <td>
              <Timestamp value={session.createdAt} />
            </td>
          </tr>
          <tr>
            <th>Revoked</th>
            <td>
              <Timestamp value={session.revokedAt} />
            </td>
          </tr>
          <tr>
            <th>Daemon heartbeat</th>
            <td>
              <HeartbeatBadge
                lastHeartbeat={session.apiKeyLastHeartbeat}
                now={now}
                staleMs={HEARTBEAT_STALE_MS}
              />
              <br />
              <Timestamp value={session.apiKeyLastHeartbeat} />
            </td>
          </tr>
          <tr>
            <th>Pending → daemon</th>
            <td>{pending}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SessionActions({
  sessionId,
  onRevoked,
  onPurged,
  onDeleted
}: {
  sessionId: string;
  onRevoked: () => void;
  onPurged: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);

  const doRevoke = async (): Promise<void> => {
    if (!confirm("Revoke this session? The chat will need to pick a profile again.")) return;
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
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const limit = MAX_INSTRUCTION_BYTES;

  return (
    <form
      className="card row"
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!content) return;
        if (content.length > limit) {
          setError(`content exceeds ${limit} bytes`);
          return;
        }
        setError(null);
        try {
          const res = await api.enqueueMessage(sessionId, { content });
          if (res) {
            setContent("");
            onEnqueued();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <textarea
        required
        maxLength={limit}
        placeholder="Instruction content"
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
          <tr>
            <th>Created</th>
            <th>Content</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={3} className="muted">
              No messages yet.
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Created</th>
          <th>Content</th>
          <th>Actions</th>
        </tr>
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
  const limit = MAX_INSTRUCTION_BYTES;

  if (editing) {
    return (
      <tr>
        <td colSpan={3}>
          <form
            className="row"
            onSubmit={async (e: FormEvent<HTMLFormElement>) => {
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

  return (
    <tr>
      <td>
        <Timestamp value={message.createdAt} />
      </td>
      <td>
        <pre>{message.content}</pre>
      </td>
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
