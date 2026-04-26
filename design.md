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

### 2.2 Why soft-delete sessions instead of hard-delete?
The daemon polls with its API key. If the row is gone, the daemon can't tell
"wrong key" from "session rotated; please shut down cleanly." A `revoked`
status lets the API return a specific `SESSION_REVOKED` signal so the daemon
can close codex gracefully (requirement: "immediately close codex and clean up
once received new session request").

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
`/v1/responses`, the bot calls `bot.api.sendMessage(chatId, …)` synchronously
and returns the Telegram send result to the daemon. Failure → HTTP error →
daemon's existing retry/backoff takes over (transient retries; permanent
failures like "bot blocked" bubble as 4xx and stop retrying).

Per-session cap of 10 still applies to queued instructions that have not
started processing: after INSERT, keep the newest 10 pending rows and drop
the oldest pending rows. In-progress rows are excluded from this trim so the
bot can track completion and resume after daemon restarts.

Delivery-for-daemon = when the daemon's poll claims a row, the row is marked
with `processing_started_at` instead of deleted immediately. The daemon then
posts progress updates with `final: false`, which update the session's latest
message for dashboards/status without sending Telegram messages. When it
posts the final response, the bot sends that response to Telegram, deletes
the in-progress row, and sends a best-effort completion acknowledgement.
Responses never queue as daemon-bound rows.

`resume_last_session` controls whether a message continues the current tool
context. Normal `/code` messages default to `true` and run FIFO. New Code
messages set it to `false`: the poll API claims the newest pending New Code
row first, clears older pending or in-progress work for that session, marks
the New Code row in progress, and leaves newer queued work pending behind it.
The daemon treats `resume_last_session=false` as an interrupt: it aborts the
active profile task, drops older queued local tasks for that profile, and
starts the New Code instruction without resume flags.

On daemon startup, the first poll includes `resumeInProgress=1`. If a session
has an in-progress row and no newer New Code row preempts it, the bot returns
a synthetic `continue` instruction with `resumeLastSession=true` so the tool
can resume the last session after a daemon restart.

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
Daemon responses are *pushed* to the chat by the bot (no "Response" button
needed — the daemon's output arrives as regular Telegram messages).

Flow:
```
/start → [ New Session ] [ Status ]
  New Session → "This will REVOKE your current session. Confirm?"
              → [ Yes, revoke and create ] [ Cancel ]
              → Yes → "Send your own API key, or press Generate"
                    → [ Generate for me ] or user sends `sk_…` text
                    → shows key + API URL hint, one-time display warning
/code <instruction>  → queued to daemon
  Status → last heartbeat, pending instruction count
  (daemon output)    → final output pushed into the chat as a regular message
                    → completion acknowledgement after the queue item clears
```

### 5.1 Why `/code` prefix rather than routing all messages?
Requirement explicit: "When sharing a message with the bot, the user need to
explicitly say that is for chatcoder coder." This avoids accidental forwarding
of conversational text to codex, and leaves room for future bot-local commands.

### 5.2 Normal Code vs. New Code

Normal Code continues the current tool session and is processed FIFO, one
in-progress instruction per chatcoder session. New Code starts fresh: it
preempts active work, clears older queued/in-progress work for the same
session, and runs before newer queued work. This gives the user an escape
hatch when the active agent is pursuing the wrong task while preserving
instructions that were queued after the New Code request.

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
- Hard cap `MAX_RESPONSE_BYTES` (default 32 KiB) — if exceeded, flush early.
- Strip ANSI escape sequences before posting (so the Telegram user sees
  readable markdown, not `\x1b[31m`).

### 7.1 Inactivity timeout
A single timer reset on every output chunk. If 1h elapses with no output and
no new instruction, `pty.kill()` — codex re-spawns on next instruction.

### 7.2 Session-reset reaction
`/poll` can return `{ reset: true }`. The daemon kills codex immediately,
clears the output buffer, then idles until its key stops working (401) or the
user re-configures it. Requirement: "immediately close codex and clean up."

### 7.3 Fake codex for tests
Tests can't assume a real `codex` binary is installed. The daemon accepts
`codexCommand` in config (default `"codex"`); tests set it to a bash script
that echoes input back with a prefix — this lets us exercise the real PTY
wrapper without depending on a cloud LLM.

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
a laptop/VM — a walkthrough-generated `~/.chatcoder-daemon/config.yml` is more
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
codexCommand: codex
codexArgs: []
cwd: /home/you/projects/myrepo
```

Sensitive values (`apiKey`) written with file mode `0600`.

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
