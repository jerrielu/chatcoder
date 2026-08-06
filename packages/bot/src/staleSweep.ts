import type { CodexReasoningEffort, MessageKind } from "@chatcoder/shared";
import type { QueuedMessage } from "./db/messages.js";

/**
 * Dependencies for the stale-task sweep. Structural types so the sweep can be
 * unit-tested with fakes while production wires in the real repos.
 */
export interface StaleSweepDeps {
  apiKeys: {
    list(args?: { status?: "active" | "revoked" }): Promise<
      Array<{ id: string; lastHeartbeat: number | null }>
    >;
  };
  sessions: {
    listActiveByApiKey(apiKeyId: string): Promise<Array<{ id: string; chatId: number }>>;
  };
  messages: {
    getProcessing(sessionId: string): Promise<QueuedMessage | null>;
    completeProcessing(sessionId: string): Promise<boolean>;
    enqueue(args: {
      sessionId: string;
      content: string;
      kind?: MessageKind;
      resumeLastSession?: boolean;
      codexReasoningEffort?: CodexReasoningEffort;
    }): Promise<unknown>;
  };
  /** A task is stale once its daemon has missed this many ms of heartbeats. */
  staleAfterMs: number;
  now?: () => number;
  /** Best-effort user notification (plain text). */
  notify?: (chatId: number, text: string) => Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * Safety net for the "kill it and rerun it" behaviour: if an in-progress task
 * belongs to an API key whose daemon has stopped heartbeating, the daemon is
 * dead — the stuck row is removed (killed) and the instruction is re-queued as
 * pending (rerun) so it executes as soon as a daemon is available again.
 *
 * Without this, a daemon crash left the in-progress row blocking the session
 * forever (the v0.10.0 stall watchdog only helps while the daemon is alive).
 *
 * Returns the number of tasks re-queued.
 */
export async function sweepStaleTasks(deps: StaleSweepDeps): Promise<number> {
  const now = deps.now?.() ?? Date.now();
  const log = deps.log ?? (() => void 0);
  let reQueued = 0;

  const keys = await deps.apiKeys.list({ status: "active" });
  for (const key of keys) {
    // A key that never heartbeated has no daemon (and therefore no in-progress
    // row — claiming work always updates the heartbeat first).
    if (key.lastHeartbeat === null) continue;
    // Daemon is alive and well — nothing here is stale.
    if (now - key.lastHeartbeat <= deps.staleAfterMs) continue;

    const sessions = await deps.sessions.listActiveByApiKey(key.id);
    for (const session of sessions) {
      let processing = await deps.messages.getProcessing(session.id);
      while (processing) {
        const staleForMs = now - key.lastHeartbeat;
        log("stale in-progress task — killing and re-queuing", {
          sessionId: session.id,
          messageId: processing.id,
          heartbeatAgeMs: staleForMs,
          staleAfterMs: deps.staleAfterMs
        });
        await deps.messages.completeProcessing(session.id);
        await deps.messages.enqueue({
          sessionId: session.id,
          content: processing.content,
          kind: processing.kind,
          resumeLastSession: processing.resumeLastSession,
          ...(processing.codexReasoningEffort
            ? { codexReasoningEffort: processing.codexReasoningEffort }
            : {})
        });
        reQueued += 1;
        if (deps.notify) {
          try {
            await deps.notify(
              session.chatId,
              `⚠️ A task was detected as stale (daemon silent for ${Math.round(staleForMs / 1000)}s) — ` +
                `killed and re-queued. It will run again when the daemon reconnects.`
            );
          } catch {
            // Best-effort notification.
          }
        }
        processing = await deps.messages.getProcessing(session.id);
      }
    }
  }
  return reQueued;
}
