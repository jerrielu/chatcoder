# Chatcoder — Design Document

> Purpose: Give a remote `codex` interactive session a Telegram-driven control plane
> so a user can type instructions from their phone and receive the process output
> without SSH'ing into the box.

This document is the single source of architectural truth. Every major decision
has three options evaluated with trade-offs and a recorded choice.

---

## 1. System architecture

Two services + one shared package:

```
  ┌──────────────┐  long-poll   ┌─────────────────────┐   HTTPS     ┌────────────────┐
  │   Telegram   │◄────────────►│   @chatcoder/bot    │◄───────────►│ @chatcoder/    │
  │    user      │              │  grammY + Fastify   │   Bearer    │    daemon      │
  └──────────────┘              │  Kysely → SQL DB    │             │ node-pty→codex │
                                └─────────────────────┘             └────────────────┘
```

- Bot = single binary running a grammY long-poller **and** a Fastify HTTPS API.
- Daemon = stand-alone CLI on the user's own machine; spawns `codex` via PTY,
  polls the bot API, streams output back.
- Shared = wire-protocol types + zod schemas, consumed by both processes.

### 1.1 Why a monorepo?
- Single source of truth for the wire protocol (prevents drift).
- One `tsc -b`, one vitest run, one coverage report, one ESLint config.
- npm workspaces (no Lerna/pnpm/turbo complexity; first-class since Node 16).

Node version is pinned via `.nvmrc` (24.15.0). Older Node majors back to 20
also work, but `better-sqlite3` is a native addon, so after changing Node
you must run `npm rebuild better-sqlite3` (or a fresh `npm install`) to
recompile it.

**Workspace dependency strategy:** the `bot`, `daemon` and `dashboard`
workspaces depend on the private `@chatcoder/shared` workspace package. The
dependency reference is pinned to the same version as the monorepo (e.g.
`"@chatcoder/shared": "0.12.2"`) rather than `workspace:*` — npm versions in
this environment ship an old `npm-package-arg` that does not understand the
`workspace:` protocol. When the reference matches the local package version,
npm links `node_modules/@chatcoder/shared` to `packages/shared` via a symlink
and never queries the registry; a mismatched (stale) reference makes npm fall
back to the registry and fail with `404 Not Found - GET
https://registry.npmjs.org/@chatcoder%2fshared`. **Every version bump must
therefore keep the `@chatcoder/shared` reference in `packages/{bot,daemon,dashboard}/package.json`
in sync with the workspace version.**

**`npm start`:** the root `start` script runs `npm run build` and then launches
the release build of both services (`chat` bot service and `coder --daemon`)
from their compiled `dist` artifacts concurrently, forwarding SIGINT/SIGTERM
to both child processes. See `scripts/start.mjs`.

**`npm run pm2:start`:** for supervised production runs, the root `pm2:start`
script builds and then asks PM2 to run both services as named processes —
`chatcoder-chat` and `chatcoder-coder` — launched from the repo-local
`bin/chatcoder.js` (so they use the compiled `dist` output), then saves the
PM2 process list. It is idempotent: it starts a new instance the first time
and restarts an existing one on later runs. See `scripts/pm2-start.mjs`.

---

## 2. Persistence layer

### Decision: Kysely + Postgres (prod) / better-sqlite3 (test/dev)

> The requirements list mentions Firebase in the intro but explicitly names
> PostgreSQL (SQLite for tests) in the detailed Required Features list. We
> treat the detailed requirement as authoritative; Firebase is not used.

**Options considered**

| # | Option                              | Pros                                                       | Cons                                                                       |
|---|-------------------------------------|------------------------------------------------------------|----------------------------------------------------------------------------|
| A | Raw `pg` / `better-sqlite3` drivers | Minimal dependencies, zero abstractions                    | SQL dialect drift between prod/test; hand-rolled types; easy to misuse     |
| B | Prisma ORM                          | Rich tooling, migrations, type-safe                        | Heavy code-gen, awkward under vitest mocking, schema duplicated from zod   |
| C | Kysely query builder + dialect swap | Typed, dialect-agnostic SQL, no codegen, test-friendly     | Manual migrations (tiny schema, fine)                                      |

**Chosen: C — Kysely.** The schema is 2 tables (`sessions`, `messages`); an ORM
is overkill. Kysely lets us write one query, execute it against Postgres or
SQLite, with zero runtime schema drift.

### 2.1 Schema

```sql
-- sessions: 1 per telegram user. session rotation = soft-delete + create new row.
sessions (
  id              TEXT  PRIMARY KEY,      -- uuid
  telegram_user   BIGINT NOT NULL,        -- tg user id (unique among active)
  api_key_hash    TEXT  NOT NULL UNIQUE,  -- sha256 of bearer; raw key never stored
  api_key_prefix  TEXT  NOT NULL,         -- first 8 chars, for UI display
  status          TEXT  NOT NULL,         -- 'active' | 'revoked'
  created_at      BIGINT NOT NULL,
  revoked_at      BIGINT,
  last_heartbeat  BIGINT,                 -- nullable, daemon alive-tracking
  last_code_at    BIGINT NOT NULL DEFAULT 0  -- rate-limit anchor
)

-- messages: undelivered instructions only (daemon-bound). ≤10 per session;
-- FIFO trim. Daemon → user responses are pushed directly to Telegram at
-- POST /v1/responses time and are never stored.
messages (
  id                     TEXT PRIMARY KEY,           -- uuid
  session_id             TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content                TEXT NOT NULL,
  resume_last_session    INTEGER NOT NULL DEFAULT 1, -- 0 = New Code, interrupt/resume fresh
  processing_started_at  BIGINT,                     -- null until claimed by a daemon
  created_at             BIGINT NOT NULL             -- ms*1024 + per-instance seq counter
)
```

The API key is stored only as a SHA-256 hash. Lookup is by hash (O(1) indexed).

**`created_at` monotonic encoding.** Two messages enqueued in the same
millisecond would otherwise have indeterminate FIFO order. We shift the
millisecond timestamp left by 10 bits and OR in a per-repo sequence counter
(bounded to 10 bits, so 1024 insertions/ms of headroom). The API-facing
`createdAt` is divided back down, so wire consumers still see plain millis.

### 2.2 Why soft-delete sessions (via admin) but hard-delete on session rotation?

The daemon polls with its API key. If the row is gone, the daemon can't tell
"wrong key" from "session rotated; please shut down cleanly." A `revoked`
status lets the API return a specific `SESSION_REVOKED` signal so the daemon
can close codex gracefully (requirement: "immediately close codex and clean up
once received new session request").

However, when the user creates a **new session** for the same Telegram chat, all
existing sessions for that `chatId` are **hard-deleted** (cascading to messages).
This guarantees a clean slate — the new session is the only one for that chat.
In-flight daemon processing for an old session will fail with a 400 validation
error on its next response POST (session not found), which is safe because the
daemon was working on stale work for a superseded session.

---

## 3. Horizontal-scale considerations

### Decision: Stateless bot instances + central SQL, in-memory rate-limit cache backed by DB

**Options considered**

| # | Option                                          | Pros                                      | Cons                                                                              |
|---|-------------------------------------------------|-------------------------------------------|-----------------------------------------------------------------------------------|
| A | Single-instance, in-memory rate limit           | Simplest                                  | Doesn't scale horizontally                                                        |
| B | Redis for rate-limit + session fanout           | Standard horizontal cache                 | Extra infra component (Redis) purely for 1-req/sec throttle; overkill             |
| C | DB `last_code_at` column + conditional UPDATE   | No new infra; consistent across replicas  | Slight write load (one UPDATE per /code); acceptable for human typing speed       |

**Chosen: C.** A single conditional `UPDATE sessions SET last_code_at=$now WHERE id=$id AND last_code_at < $now-1000`
returns 1 on accept / 0 on throttled. Atomic, works across any number of replicas.
**Long polling** is preferred over webhooks (requirement: "long polling"), which
means each bot replica holds an independent telegram connection — grammY's
`allowed_updates` + unique `getUpdates` offsets per instance could conflict.
For true multi-instance we'd elect a leader; in practice, **one bot instance is
sufficient** and the API tier can be scaled separately (the scaling constraint
is HTTP requests from daemons, not telegram updates). We keep the code stateless
so running multiple *API* replicas behind a load balancer is safe.

---

## 4. Message queue model

### Decision: Single `messages` table holding instructions only; responses pushed to Telegram

**Options considered**

| # | Option                                         | Pros                                       | Cons                                              |
|---|------------------------------------------------|--------------------------------------------|---------------------------------------------------|
| A | Two tables (`instructions`, `responses`)       | Most explicit                              | Duplicated DDL; redundant now that responses aren't queued |
| B | One `messages` table, `direction` column       | DRY                                        | Half the table is dead weight — responses no longer queue |
| C | One `messages` table, instructions only        | Simplest; matches the actual data flow      | n/a — `direction` was the abstraction we removed  |

**Chosen: C.** Instructions queue because the daemon polls (can't push to a
box behind NAT). Responses *don't* queue: when the daemon POSTs
`/v1/responses`, the bot sends the response content as a **new Telegram message**
and attaches a clean Markdown file (`response.txt`) containing the full response
with MarkdownV2 escapes stripped, with caption "✅ Message processed", and
returns to the daemon.
Failure → HTTP error → daemon's existing
retry/backoff takes over (transient retries; permanent failures like "bot
blocked" bubble as 4xx and stop retrying).

Per-session cap of 10 still applies to queued instructions that have not
started processing: after INSERT, keep the newest 10 pending rows and drop
the oldest pending rows. In-progress rows are excluded from this trim so the
bot can track completion and resume after daemon restarts.

Delivery-for-daemon = when the daemon's poll claims a row, the row is marked
with `processing_started_at` instead of deleted immediately. The daemon then
posts progress updates with `final: false`, which update the session's latest
message for dashboards/status AND edit the original "Daemon is processing"
Telegram message in-place (best-effort) so the user sees live progress. When it
posts the final response, the bot sends the response content as a **new Telegram
message** (leaving the processing/progress message untouched), attaches a clean
Markdown file (`response.txt`) containing the full response with MarkdownV2
escapes stripped, cleans up the in-progress Telegram processing state, and
*then* deletes the in-progress DB row. The processing state is cleaned up
first (via `sendProcessed`) to avoid a race where deleting the DB row allows a
concurrent poll to claim a new task and overwrite the in-memory map entry
before the cleanup reads it.

Final responses ≤ `MAX_RESPONSE_BYTES` (512 KB, raised from 32 KB in v0.9.2)
are sent in a single `{final: true}` HTTP POST, so the full content reaches
`state.response` and the downloadable `response.txt` contains the complete log.
If the final response still exceeds 512 KB it is split into ~3.5 KB chunks:
the first N-1 chunks are sent as progress updates (`final: false`) and the last
chunk is sent as `{final: true}` carrying the **full** text — so even in this
corner case `response.txt` contains the complete answer rather than only the
last fragment. The chunk size for progress updates and Telegram display is 3500
characters (leaving room for markup). Responses never queue as daemon-bound
rows.

The bot's `sendResponse` (`packages/bot/src/main.ts`) accumulates the **full**
response text in `state.response` so the downloadable `response.txt` attachment
contains everything, while the visible Telegram message is sent as a **brand new
message** (not editing the processing/progress message). The visible message is
capped at Telegram's 4096-character hard limit; if the response exceeds it,
`sendResponse` shows the **beginning** of the response with a truncation marker:
"— Truncated — full response in response.txt". The processing message remains
intact, showing the live progress updates that were streamed during execution.

`resume_last_session` controls whether a message continues the current tool
context. Normal `/code` messages default to `true` and run FIFO. New Code
messages set it to `false`.

**Claim strategy (v0.5.4+):** The poll API only claims new work for a session
when no row has `processing_started_at` set. If a row is already in progress,
the session is skipped — new items stay as pending (`processing_started_at =
null`) and will be claimed on a future poll after the current task completes.
This ensures at most one claimed task per session at any time, which keeps
Status accurate (pending count = unclaimed items, processing = the single
claimed item) and prevents the Telegram progress-editing state from being
overwritten by a subsequent claim.

When the session has no in-progress row, New Code rows take priority: the poll
claims the newest pending New Code first, clears older *pending* work for that
session, marks the New Code row in progress, and leaves newer queued work
pending behind it. If no New Code row exists, the next regular instruction is
claimed instead.

The daemon treats `resume_last_session=false` as an interrupt: it aborts the
active profile task, drops older queued local tasks for that profile, and
starts the New Code instruction without resume flags.

On daemon startup, the first poll includes `resumeInProgress=1`. If a session
has an in-progress row and no newer New Code row preempts it, the bot returns
a synthetic `continue` instruction with `resumeLastSession=true` so the tool
can resume the last session after a daemon restart. Because the Telegram
"processing" message and its edit state live in the bot's memory, the resume
path also re-creates the processing notification (with the **original**
instruction content) — the bot posts it only when it has no state for the
session, so a bot restart doesn't leave progress invisible, and a
daemon-only restart doesn't produce a duplicate message.

---

## 5. Telegram UX

### Decision: Inline-keyboard main menu + grammY conversations for multi-step flows

**Options considered**

| # | Option                                         | Pros                                            | Cons                                        |
|---|------------------------------------------------|-------------------------------------------------|---------------------------------------------|
| A | Slash commands only                            | Simple                                          | Poor discoverability, no button UX          |
| B | Reply keyboards (persistent)                   | Always visible                                  | Clutters chat; no fine-grained callbacks    |
| C | Inline keyboards + conversations plugin        | Button-per-message, natural two-step confirm    | Slightly more state to manage               |

**Chosen: C.** Matches the requirement "telegram interactive inline keyboard
menus that covers create new session, check status, check response."
Daemon responses are *pushed* to the chat by the bot as new messages
(progress updates still edit the "processing" message in-place).
The final response is sent as a **new message** (not editing the processing
message) and also attaches the full response as a markdown file with caption
"✅ Message processed".

Flow:
```
/start → [ New Session ] [ Status ]
  New Session → "This will REVOKE your current session. Confirm?"
              → [ Yes, revoke and create ] [ Cancel ]
              → Yes → "Send your own API key, or press Generate"
                    → [ Generate for me ] or user sends `sk_…` text
                    → shows key + API URL hint, one-time display warning
/code <instruction>  → "🔄 Daemon is processing your message…" (sent once)
  Status → last heartbeat, pending instruction count
  (daemon progress)  → processing message edited in-place with live progress
  (daemon output)    → new message sent with final response (processing message untouched)
                    → full response attached as markdown file with "✅ Message processed" caption
```

### 5.1 Why `/code` prefix rather than routing all messages?
Requirement explicit: "When sharing a message with the bot, the user need to
explicitly say that is for chatcoder coder." This avoids accidental forwarding
of conversational text to codex, and leaves room for future bot-local commands.

### 5.2 Normal Code vs. New Code

Normal Code continues the current tool session and is processed FIFO, one
in-progress instruction per chatcoder session. New Code starts fresh: it
preempts active work *at the daemon level* only if the daemon has not yet
started executing it, clears older queued work for the same
session, and runs before newer queued work. If the previous instruction is
already running, New Code waits behind it in the daemon's FIFO queue. The
in-progress DB row is preserved so 📡 Status remains accurate.

### 5.3 New Code (with Review)

New Code (with Review) extends New Code by automatically composing a code
review prompt before the user's instruction. When the user taps
`🔬 New Code + Review` and enters an instruction (e.g. "Add a login page"),
the bot sends the following combined prompt to the daemon in a fresh session:

```
Deep Dive Code Review on the previous commit and uncommitted changes to make sure it
complies with the software engineering principles such as SOLID, and it can achieve what
user asked: {user instruction}
```

**Implementation:** The `awaiting_instruction` flow state gains an optional
`review?: boolean` flag. When `true`, `handleInstructionSubmission` prepends
the review prompt template to the user's instruction before passing it to
`handleCode`. The daemon and CLI tools receive a plain instruction string —
no schema or daemon changes are needed.

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | **Bot-side prompt composition (chosen)** | Zero daemon changes; prompt is just a string; easy to modify template | Prompt is opaque to daemon |
| B | New `kind: "review"` field on messages table | Explicit semantics | Schema change; over-engineering for a prompt prepend |
| C | Daemon-side prompt injection | Prompt lives with execution context | Tight coupling; requires daemon code change |

**Chosen: A.** The review prompt is a text string prepended to the user's
instruction. The daemon and CLI tools don't need to know it's a "review" —
they just receive a combined instruction.

---

## 6. API key lifecycle

### Decision: User-supplied OR server-generated 48-char URL-safe key; stored hashed.

**Options considered**

| # | Option                       | Pros                                    | Cons                                                   |
|---|------------------------------|-----------------------------------------|--------------------------------------------------------|
| A | JWT tokens signed by bot     | Stateless                               | Revocation requires a blocklist anyway                 |
| B | Opaque random token (hash in DB) | Simple, revocable by deleting row | Requires storage (we have storage already)             |
| C | mTLS                         | Strongest                               | Ops burden for the user (distributing certs on phone?) |

**Chosen: B.** Key format: `cc_` + 48 base64url chars from `crypto.randomBytes(36)`.
We reject keys shorter than 16 chars from user input; we display the full key
exactly once; we store only sha-256(key) to keep the DB safe if leaked.

---

## 7. Daemon ↔ codex integration

### Decision: `node-pty` spawned lazily on first instruction; output terminated by idle-quiet-period heuristic

**Options considered**

| # | Option                                     | Pros                                     | Cons                                                                                  |
|---|--------------------------------------------|------------------------------------------|---------------------------------------------------------------------------------------|
| A | `child_process.spawn` with pipes           | Zero native deps                         | Codex is interactive and uses TTY features — misbehaves without a PTY                 |
| B | `node-pty` (node-addon-api)                | Real PTY, correct ANSI / prompt handling | Native compile                                                                        |
| C | Send each instruction through a new `codex exec` | Fresh process each time          | Kills the whole purpose — the "session" context is gone between instructions          |

**Chosen: B — node-pty.** We keep a single long-lived codex PTY per daemon run.
One problem PTYs introduce: knowing when the agent has *finished* responding.
We solve it with an **idle-quiet heuristic**:

- Collect output chunks into a rolling buffer.
- When no chunk arrives for `QUIET_MS` (default 1500ms) AND the buffer is
  non-empty, flush buffer as one response message.
- Hard cap `MAX_RESPONSE_BYTES` (default 512 KiB) — if exceeded, flush early.
- Strip ANSI escape sequences before posting (so the Telegram user sees
  readable markdown, not `\x1b[31m`).

### 7.1 Stall watchdog (replaces the old inactivity timeout)

`ToolExecutor.execute()` arms a watchdog timer that is **reset on every output
chunk** (stdout/stderr). If the child process emits nothing for
`stallTimeoutMs` (default 15 minutes, `0` disables), the process group is
killed (SIGTERM → SIGKILL after a 2 s grace) and — since 0.12.0 — **the same
task is automatically relaunched** (same message, same resume flags) so
progress keeps updating under the same session, up to `stallRetries` times
(default 3, `0` disables the relaunch = the old fail-fast behaviour). Only when
the relaunch attempts are exhausted does the execution reject with a
descriptive `StallTimeoutError`, which the runner posts as a final response so
the task completes and the session unblocks.

This matters because a hung provider call or dead network produces **no output
at all**: without the watchdog, the progress timer has nothing to flush, the
Telegram progress message freezes at the last chunk, and the in-progress DB row
blocks the session forever (observed as a 2.5 h freeze in production). The
watchdog turns that into either a transparent re-run (transient hang) or a
clear error the user can act on (check provider/network, retry). It applies to
every tool type (reasonix / claude / codex / custom), not just the PTY path.

Tool children are spawned `detached` so each is a process-group leader, and
every kill path (stall, abort, shutdown, startup sweep) kills the whole group
via `kill(-pid)` — tool CLIs are two-level (a node wrapper that spawns the
real binary), and killing only the direct child used to orphan the binary,
leaving frozen tasks running after restarts.

### 7.2 Session-reset reaction
`/poll` can return `{ reset: true }`. The daemon kills codex immediately,
clears the output buffer, then idles until its key stops working (401) or the
user re-configures it. Requirement: "immediately close codex and clean up."

### 7.3 Fake codex for tests
Tests can't assume a real `codex` binary is installed. The daemon accepts
`codexCommand` in config (default `"codex"`); tests set it to a bash script
that echoes input back with a prefix — this lets us exercise the real PTY
wrapper without depending on a cloud LLM.

### 7.4 Stale-process lifecycle: "kill it and rerun it"

The v0.10.0 stall watchdog only works while the daemon is alive. A dead or
orphaned daemon leaves its tool children running and its in-progress DB row
blocking the session forever — observed in production as 4 orphaned daemons
(ppid 1, running pre-watchdog code) plus 4 orphaned reasonix children (two of
them duplicating the same task at ~90 % CPU each), which froze the game
session's progress message and pushed host load to ~7.5.

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | Keep only the daemon-side stall watchdog | Already shipped, no new code | Does nothing when the daemon itself dies/orphans |
| B | Single-instance registry + kill-on-exit + bot heartbeat sweep | Kills stale daemons/tools on the host and re-queues dead tasks; no zombie accumulation | A small state file to maintain; re-queue races if a wedged daemon revives |
| C | Bot only: mark stale rows failed and require manual retry | Simple | Leaves the user stuck when the daemon is gone; no automatic rerun |

**Chosen: B — layered stale detection and recovery:**

1. **Daemon registry** (`packages/daemon/src/daemonState.ts`):
   `~/.chatcoder/daemon-state.json` = `{ daemonPid, startedAt, toolPids }`,
   written atomically (tmp + rename). `ToolExecutor` registers each child PID
   on spawn and unregisters on close. Tool children are spawned `detached`
   (process-group leaders) so `killProcessTree`/`kill(-pid)` can reach the
   whole two-level CLI tree (node wrapper → real binary), not just the direct
   child.
2. **Startup sweep**: before registering with the bot, the daemon kills the
   previous daemon (if alive) and every registered tool **tree** (`killProcessTree`),
   then claims sole ownership. Restart is therefore a clean handover, never a
   stack-up.
3. **Exit cleanup**: SIGINT/SIGTERM kills registered tool trees and clears
   the registry; a sync `process.on("exit")` handler SIGKILLs each group
   (`kill(-pid)`) as a fallback for hard kills/crashes.
4. **Periodic self-sweep** (60 s): if another daemon took over the registry,
   the superseded daemon kills its children and exits; dead tool PIDs are
   pruned.
5. **CLI wrapper forwards signals** (`bin/chatcoder.js`): the wrapper now
   `spawn`s the daemon/bot and forwards SIGINT/SIGTERM, so a PM2/systemd
   restart kills the whole tree instead of orphaning the child. (The previous
   `spawnSync` wrapper died on SIGTERM while the child survived, reparented to
   PID 1 — the root cause of the orphan accumulation.)
6. **Bot stale-task sweep** (`packages/bot/src/staleSweep.ts`, every 60 s):
   for each active API key whose last heartbeat is older than
   `heartbeatStaleMs` (default 60 s), any in-progress row is deleted (killed)
   and its instruction re-queued as pending (rerun) with the same content,
   kind, resume flag and reasoning effort; the user gets a plain-text Telegram
   notice. A key that never heartbeated is skipped (no daemon ever ran).

Known trade-off: if a daemon is wedged but its HTTP client recovers, the bot
may re-queue a task the old daemon still finishes — an unlikely duplicate
(requires ≥ 60 s without any heartbeat) rather than a frozen session; the
daemon's 30 s request timeout (v0.9.3) makes the wedge window small.

### 7.5 Reasonix always runs with auto permission mode

Reasonix launches (daemon sessions via `reasonix run ...` and interactive TUI
launches via `reasonix ...`) append `--permission-mode auto` **after** the
profile's `extraArgs`, so every reasonix run auto-approves ordinary writer
fallbacks while still asking for genuinely risky operations.

**Options considered**

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | Per-profile `extraArgs: ["--permission-mode", "auto"]` in `config.yml` | No code change; per-profile control | Forgettable on new profiles (setup wizard starts with `extraArgs: []`); silently re-enables prompts if omitted |
| B | Force `--permission-mode auto` in code, before `extraArgs` | Always on by default | Profiles could accidentally override it via `extraArgs` |
| C | Force `--permission-mode auto` in code, **after** `extraArgs` (chosen) | Always on, cannot be overridden — one uniform behaviour for every reasonix run | A profile can no longer opt out per-profile |

**Chosen: C.** The operator wants every reasonix run in auto mode, period.
Placing the flag after `extraArgs` makes the guarantee unconditional, keeps the
config files free of the repeated workaround, and matches how the CLIs are
launched in both `packages/daemon/src/launcher.ts` (TUI) and
`packages/daemon/src/toolExecutor.ts` (daemon sessions). If a per-profile
opt-out is ever needed, the flag would move back into the profile config
(option A).

---

## 8. Polling strategy

### Decision: Short polling (2s) with jitter; heartbeat every 15s

**Options considered**

| # | Option                                  | Pros                        | Cons                                                                      |
|---|-----------------------------------------|-----------------------------|---------------------------------------------------------------------------|
| A | Long-poll the API (hold HTTP for 30s)   | Low latency; fewer requests | Fastify connection pressure; harder to reason about reset signals         |
| B | Short-poll every 2 s                    | Dead simple; cheap          | Up to 2 s latency between /code and daemon starting work                  |
| C | WebSocket / SSE push                    | Instant                     | Extra protocol surface; harder to auth uniformly; overkill for human chat |

**Chosen: B.** Human-chat latency of ≤2 s is fine and the operational model
stays trivial. Jitter ±250ms avoids thundering-herd across multiple daemons.

Heartbeat on a separate timer at 15 s — independent of poll so it reports
liveness even if polling is momentarily starved.

---

## 9. Configuration

### Decision: env-vars for the bot (12-factor), interactive setup → YAML file for the daemon

The bot is a service — env-vars are natural. The daemon is a user tool run on
a laptop/VM — a walkthrough-generated `~/.chatcoder/config.yml` is more
ergonomic.

Bot env-vars (all parsed through zod in `packages/bot/src/config.ts`):

| Env var                  | Required | Default     | Purpose                                          |
|--------------------------|----------|-------------|--------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`     | yes      | —           | BotFather token                                  |
| `DATABASE_URL`           | no       | `sqlite:./chatcoder.db` | `sqlite::memory:` / `sqlite:path.db` / `postgres://…` |
| `BOT_LISTEN_HOST`        | no       | `0.0.0.0`   | HTTP bind host                                   |
| `BOT_LISTEN_PORT`        | no       | `8080`      | HTTP bind port                                   |
| `BOT_LOG_LEVEL`          | no       | `info`      | pino level                                       |
| `BOT_PUBLIC_URL`         | no       | —           | URL shown in key hand-off                        |
| `BOT_HEARTBEAT_STALE_MS` | no       | `60000`     | Age after which status shows "offline"           |

`DATABASE_URL` accepts any of: `sqlite::memory:`, `sqlite://:memory:`,
`sqlite:relative.db`, `sqlite:/abs/path.db`, `sqlite:///abs/path.db`,
`postgres://…`, `postgresql://…`.

Daemon config:

```yaml
apiUrl: https://bot.example.com
apiKey: cc_xxxxxxxx…
pollIntervalMs: 2000
heartbeatIntervalMs: 15000
idleShutdownMs: 3600000       # 1 hour
stallTimeoutMs: 900000         # 15 min without tool output → kill + relaunch task (0 disables)
stallRetries: 3                # relaunch attempts after a stall before failing (0 disables relaunch)
codexCommand: codex
codexArgs: []
cwd: /home/you/projects/myrepo
```

Sensitive values (`apiKey`) written with file mode `0600`.

Runtime state (not config): `~/.chatcoder/daemon-state.json` records the
current daemon PID and its tool children so a restart can kill whatever the
previous run left behind (see §7.4). Override for tests:
`CHATCODER_STATE_FILE`.

---

## 10. Testing strategy

Don't need to write any tests.
<!-- Coverage targets are enforced in `vitest.config.ts`: **98 %** for statements,
lines, and functions; **90 %** for branches. The lower branches target is a
pragmatic choice — exhaustively covering every defensive `if (!x) return`
costs more tests than it's worth, but the main behavioral paths are asserted. -->

| Layer                 | Tool                                      | Key cases                                                                                   |
|-----------------------|-------------------------------------------|---------------------------------------------------------------------------------------------|
| shared types/schemas  | vitest                                    | zod parse happy/sad                                                                         |
| db repositories       | vitest + better-sqlite3 in-memory         | 10-item cap, FIFO drop, in-progress lifecycle, New Code preemption, soft-delete revocation, rate-limit atomic upsert |
| bot API               | vitest + `fastify.inject` (no network)    | auth pass/fail, resume-in-progress poll, New Code preemption, heartbeat updates, response post |
| bot Telegram handlers | vitest + fake grammY Context              | menu callbacks, two-step confirm, rate limit rejection, /code instruction capture           |
| daemon client         | vitest + stubbed `fetch`                  | auth header, retry on 5xx, 4xx non-retry, shutdown on 401                                   |
| daemon PTY            | vitest + fake spawner                     | idle flush, byte cap, inactivity kill, reset kill                                           |
| daemon orchestrator   | vitest + fake API + fake PTY              | end-to-end: instruction → tool execution → progress/final response post, startup resume polling |
| system                | vitest, single process, real bot+daemon   | new session → /code → codex echo → Response command delivers                                |

No test is allowed to assert trivial truths like `expect(true).toBe(true)` —
every test has a user-observable behavioral claim.

---

## 11. Error model

All API errors share one shape:

```json
{ "error": { "code": "SESSION_REVOKED", "message": "…human readable…" } }
```

Codes: `UNAUTHORIZED`, `SESSION_REVOKED`, `RATE_LIMITED`, `QUEUE_FULL`,
`VALIDATION_ERROR`, `INTERNAL`. Defined in `@chatcoder/shared/errors`.

The daemon's `ApiClient` classifies responses into three buckets:

| HTTP        | Behavior                                       |
|-------------|------------------------------------------------|
| 401         | throws `UnauthorizedError` (stop immediately)  |
| 410         | throws `SessionRevokedError` (stop immediately) |
| Other 4xx   | throws `ApiClientError` (no retry — bad request) |
| 5xx         | retry with exponential backoff                 |
| Network err | retry with exponential backoff                 |
| **Timeout** (30 s default) | retry with exponential backoff (`AbortController` + `setTimeout`) |

Every HTTP request from the daemon to the bot API enforces a configurable
timeout via an `AbortController` (default 30 s, `ApiClientOptions.timeout`).
The timer is always cleaned up in a `finally` block.  This prevents the
cascading failures described in *§14.5 — Stale fetches*: when a `postResponse`
request hung indefinitely, `flushInFlight` in `SessionRunner` got permanently
stuck at `true`, silently dropping all subsequent progress updates; and when a
`poll` request hung, `Orchestrator.tickPoll()` never rescheduled the next poll
cycle, starving the daemon of new work.  Both the progress and poll paths use
independent `fetch` calls, so a single stalled request blocks only its own
pathway.

Retrying 4xx is pointless — the server will keep rejecting the same malformed
body — so we fail fast and surface the original error code instead.

---

## 12. Security

- API key never logged; log `apiKeyPrefix` (first 8 chars) only.
- Constant-time comparison not needed because we look up by hash, never by
  scan.
- Input length caps: instruction ≤ 4 KiB, response ≤ 32 KiB (matching
  Telegram's practical message size before we'd paginate).
- Fastify bodyLimit set to 64 KiB.
- CORS disabled by default (daemons are server-to-server).
- Two-step confirmation for session rotation makes accidental revocation
  essentially impossible.

---

## 13. Open items / deliberately out of scope

- Multiple concurrent sessions per user (explicitly disallowed by requirement).
- Bot webhook mode (requirement specifies long polling).
- Redis/Firebase (see §2, §3).
- Multi-daemon per session (YAGNI; one daemon = one session).

---

## 14. Admin dashboard (`@chatcoder/dashboard`)

A separate workspace serving a local web UI for CRUD on sessions and the
message queues. Read-only on most state (heartbeat, pending counts), writable
on everything else.

**Options considered**

| # | Option                                                  | Pros                                       | Cons                                                                |
|---|---------------------------------------------------------|--------------------------------------------|---------------------------------------------------------------------|
| A | Mount admin routes on the existing bot Fastify app      | One process, one port                      | Couples bot lifecycle to admin UI; bot bodyLimit / auth differ      |
| B | Separate workspace, server-rendered HTML + HTMX         | Fastest to ship; no bundler; reuses bot DB | A second process to start                                           |
| C | Separate workspace, React SPA + JSON admin API          | Familiar for heavy extension               | Bundler, router, state mgmt; doubles surface area for one operator  |

**Chosen: C, revised.** The dashboard is a pure frontend: React + Vite,
built to static assets. It has no Node server. A static host (Vite dev
server, `npx serve`, nginx, etc.) delivers `index.html` and the bundle to
the browser, which then calls the bot's admin API at `/v1/admin/*` via
`fetch`. See §14.2 for the data flow and §14.3 for the admin-auth analysis.

### 14.1 Auth posture

**Two loopback gates, both on the bot:**

- **Peer IP gate** (`installLoopbackGuard`): `req.socket.remoteAddress` must
  be `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`. Otherwise: silent 404.
- **Origin gate** (`installAdminCors`, `@fastify/cors`): for requests with an
  `Origin` header (i.e. browsers), the hostname in that origin must be
  loopback. Non-loopback origins get no `Access-Control-Allow-Origin` and
  the browser refuses to expose the response.

Together: only a browser running on the same host as the bot can call admin
endpoints. The dashboard itself has no auth — it's static files.

### 14.2 Data access

- The dashboard is a Vite + React SPA. All calls go through a tiny client
  module (`packages/dashboard/src/api/client.ts`) that wraps `fetch` with
  zod response validation.
- Admin query code lives in the bot (`packages/bot/src/db/admin.ts` →
  `AdminRepo`). Write paths reuse `SessionsRepo.rotate` and
  `MessagesRepo.{enqueue, count, purgeSession}`.
- Wire shapes are defined once in `@chatcoder/shared/admin` (zod) and
  consumed by both the bot's `/v1/admin` handlers (for request/response
  validation) and the dashboard's client (for response validation).

### 14.3 Admin-auth options considered

| # | Option                                              | Pros                                                | Cons                                                                     |
|---|-----------------------------------------------------|-----------------------------------------------------|--------------------------------------------------------------------------|
| A | Shared admin token (env var on bot and dashboard)   | Safe even with bot on 0.0.0.0 and remote dashboard  | One more secret; easy to leak via inspect-element; no benefit over loopback |
| B | Two loopback gates (peer IP + browser Origin)       | Zero config; follows the "same-host operator" model | Dashboard must share host with bot (or tunnel)                            |
| C | No auth, admin routes always exposed                | Simplest                                            | Anyone with network reach to bot port owns the sessions                   |

**Chosen: B.** `@fastify/cors` is registered with an origin callback that
only allows hostnames in `{127.0.0.1, localhost, ::1, [::1]}`. Daemon
routes have no browser origin, so CORS headers are irrelevant to them.

### 14.4 Rendering

- React components render from JSON responses; XSS-safe by default (React
  escapes expressions in JSX). Client-side routing via `react-router-dom`.
- `usePolling` hook re-fetches on a timer (15s for the sessions list, 10s
  for session detail) so the UI stays fresh without manual refresh.
- Build: `vite build` → `packages/dashboard/dist/` (static HTML + JS + CSS).
  Dev: `vite` dev server with HMR.

---

## 15. Versioning and changelog

### Decision: Semver-manual bump + `changes.md` + Telegram menu display

The monorepo carries its version in every `package.json` (root + 4 workspaces).
These are all manually bumped together when the version changes. The
`APP_VERSION` constant used by the Telegram bot and other runtime code is
**auto-generated** from the root `package.json` at build time by
`scripts/generate-version.mjs` — eliminating the need to manually keep
`packages/shared/src/constants.ts` in sync.

**Options considered**

| # | Option                                          | Pros                                          | Cons                                                 |
|---|-------------------------------------------------|-----------------------------------------------|------------------------------------------------------|
| A | `npm version` + git tag                         | Single command for all package.json files     | Doesn't update shared `APP_VERSION` constant; tags   |
| B | Manual bump with AGENTS.md checklist            | Full control; AGENTS.md already covers it     | Easy to forget a file                                |
| C | Automated script that bumps everything at once  | Zero human error                              | Yet another script to maintain                       |
| D | **Build-time generation** (chosen)              | Single source of truth (root package.json); generated file is gitignored, never drifts | One small prebuild script to maintain |

**Chosen: D — build-time generation from root `package.json`.** The root
package.json is the single source of truth. `scripts/generate-version.mjs` reads
the root `package.json` version and writes
`packages/shared/src/generated-version.ts`. This file is gitignored so it never
pollutes the working tree. Generation is wired into two places so the file
always exists before `tsc` resolves the import: (1) the `shared` package's npm
`prebuild` hook, and (2) the root `generate-version` script, which the root
`build:runtime` and `typecheck` scripts run explicitly **before** their direct
`tsc -b` invocations. The root scripts call `tsc -b` directly (to drive the
project references) rather than `npm run build`, so they must generate the file
themselves — relying solely on the `shared` `prebuild` hook would skip it and
break compilation (and thus `npm install` → `prepare` → `build:runtime`). Step 1
of the Post-Change Automation in AGENTS.md lists every file that carries the
version (now only package.json files; the constants.ts entry was removed since
it is auto-generated).

### 15.1 Changelog (`changes.md`)

The file lives at the repo root. Each version entry has the version number,
the date in ISO‑8601 (YYYY-MM-DD), and bullet points describing what changed
and why. The Telegram bot displays the two most recent entries when the user
taps the version button in the main menu.

### 15.2 Telegram UX

- The main menu shows a `📦 vX.Y.Z` button at the bottom row.
- Tapping it calls `handleVersion()` in `packages/bot/src/bot/handlers.ts`,
  which reads `changes.md` from disk and returns the current version +
  latest changelog entries formatted as Markdown.
- The version is also available at compile time via `APP_VERSION` from
  `@chatcoder/shared`.

---

## 16. Voice message transcription

Telegram voice messages (`message:voice`) are downloaded and transcribed
locally on the server using whisper.cpp (the C++ port of OpenAI's Whisper).

### Flow

1. `bot.on("message:voice", ...)` in `wireBot()` receives the update.
2. The handler replies "🎤 Transcribing voice message…" immediately.
3. `ctx.getFile()` retrieves the file metadata from Telegram.
4. The OGG Opus audio is downloaded via `https://api.telegram.org/file/bot<token>/<file_path>`.
5. **ffmpeg** converts the OGG to 16 kHz mono 16-bit PCM WAV.
6. **whisper.cpp** (`build/bin/main`) transcribes the WAV with the multilingual
   `base` model, auto-detecting the language (`-l auto`).
7. The transcribed text is shown to the user, then injected into the same
   `handleInstructionSubmission()` flow as a typed instruction.

### Optional dependency & graceful degradation

Voice transcription depends on the optional `whisper-node` npm package (and its
bundled, cmake-built whisper.cpp). The `transcription` module does **not**
require it at import time: `isTranscriptionAvailable()` checks for the
`whisper-node` install, and `transcribeAudio()` returns `""` (with a warning)
when it is absent, so the rest of the bot keeps working. If a user sends a
voice message on a server without whisper installed, the voice handler replies
that transcription is unavailable and asks them to type their instruction
instead. The absence of `whisper-node` therefore degrades only voice
transcription, never the core text/menus functionality.

### Language support

The multilingual `base` model supports 99 languages. English and Chinese are
auto-detected with no configuration needed.

### Resource usage

- **Model**: `ggml-base.bin` (~142 MB disk, ~388 MB RAM at inference).
- **CPU**: ~3–4× real-time on ARM Cortex-A76 (e.g., 10 s for a 3 s message).
- **Dependencies**: ffmpeg (via apt), whisper.cpp (built via cmake from the
  `whisper-node` npm package installation).

### Options considered

| # | Option | Pros | Cons |
|---|--------|------|------|
| A | **Local whisper.cpp (chosen)** | Free, private (no data leaves server), offline, auto-detects EN/ZH | Uses 388 MB RAM during inference; ~4 s for a short message |
| B | OpenAI Whisper API | Accurate, simple REST call, no model download | Costs $0.006/min; requires internet; data leaves server |
| C | Google Cloud Speech-to-Text | Free tier (60 min/month) | Requires GCP account; data leaves server; more complex auth |
| D | Vosk (local) | Lighter than whisper.cpp (~50 MB) | Lower accuracy, especially for Chinese; needs separate models per language |

**Chosen: A — local whisper.cpp** for zero ongoing cost, offline operation,
privacy (audio never leaves the server), and transparent EN/ZH support.


