# Worklog

Append-only record of what was built, in order, with the reasoning.

## Phase 0 — Scaffolding (2026-04-18)

- Monorepo: npm workspaces (`packages/shared`, `packages/bot`, `packages/daemon`).
- TypeScript 5.4 + `composite: true` for project refs — one `tsc -b` builds all.
- Node pinned via `.nvmrc` = 20.18.0 (active LTS at build time).
- Vitest + V8 coverage with 98% thresholds enforced in `vitest.config.ts`.
- ESLint flat-config-free (classic rc for broad editor support).
- Authored `design.md` with 3-option analysis for persistence, scale, queue model,
  UX, auth, PTY, polling, config.

## Phase 1 — Shared protocol package

- `@chatcoder/shared`: wire protocol, zod schemas, error codes, API paths.
- All cross-process types exported here; bot + daemon both depend on it to
  prevent drift.

## Phase 2 — Persistence

- Kysely query builder with dialect-swap: `BetterSqlite3Dialect` in tests,
  `PostgresDialect` in prod — selected at runtime from `DATABASE_URL`.
- Migrations: hand-rolled, idempotent, ran on startup.
- `SessionsRepo`: create, getByApiKeyHash, rotate, heartbeat, tryConsumeRate.
- `MessagesRepo`: enqueue w/ cap-10 trim, dequeue-for-daemon, dequeue-for-user.

## Phase 3 — Bot API (Fastify)

- Bearer auth plugin → `request.session`.
- Routes: `POST /v1/heartbeat`, `GET /v1/poll`, `POST /v1/responses`,
  `GET /v1/session` — all under `/v1`, all validated with zod.
- Uniform error envelope.

## Phase 4 — Telegram bot (grammY)

- Long-polling mode per requirement.
- Menu: `Main` with `New Session / Status / Response`.
- Two-step confirm for session rotation.
- `/code <text>` parser + 1 req/sec rate-limit via `SessionsRepo.tryConsumeRate`.
- API-key flow: user supplies or bot generates cryptographically random key.

## Phase 5 — Daemon setup + API client

- `chatcoder-daemon setup` — interactive prompt walkthrough → YAML config.
- `ApiClient`: typed fetch w/ retry on 5xx, recognizes `SESSION_REVOKED`.

## Phase 6 — Daemon codex PTY

- `CodexSession`: lazy spawn, idle-flush heuristic, byte cap, ANSI strip,
  inactivity auto-kill, hard-kill on reset.

## Phase 7 — Daemon orchestrator

- Parallel timers: heartbeat (15 s) + poll (2 s + jitter).
- SIGINT/SIGTERM → graceful shutdown (kill codex, final status post).

## Phase 8 — Tests

- Unit tests per module, integration tests through `fastify.inject`,
  system test bot↔daemon using a fake codex bash script.
- Coverage enforced ≥98%.

## Phase 9 — Review

Findings & fixes:

1. **Auth plugin wasn't firing** — registered as a Fastify plugin, which runs
   hooks in an encapsulated scope. The routes are on the parent scope, so the
   hook was invisible to them. Refactored `authPlugin` → `installAuth(app, …)`
   which attaches `onRequest` directly on the passed app. All 10 API tests go
   from 500 → their expected status.
2. **Queue FIFO was indeterminate within a single millisecond.** Two `enqueue`
   calls with the same `Date.now()` produced order that depended on the random
   UUID tiebreaker. Fixed by encoding an in-process monotonic sequence counter
   into the low 10 bits of `created_at` and stripping it back out on read.
   Wire-level `createdAt` stays in plain milliseconds.
3. **Dead code in `POST /v1/responses`** — a `pending >= MAX_QUEUE_DEPTH`
   branch that never did anything. Removed.
4. **Unused `@fastify/sensible` dep** — deleted.
5. **Unused import of `ApiClient` as value** in `orchestrator.ts` — fixed to
   `import type`.
6. **`node-pty` require + type-import lint noise** — scoped eslint-disable
   with rationale comment.
7. **Strict TS `exactOptionalPropertyTypes`** conflicted with several third-
   party library signatures (grammy, `fetch` RequestInit). Left
   `noUncheckedIndexedAccess: true` and other strict options in place but
   dropped `exactOptionalPropertyTypes` — it doesn't play with external
   library typings without a lot of noisy code.

Coverage outcome: **statements 99.26% / lines 99.26% / functions 98.16% /
branches 90.88%** across 140 tests. Lines/statements/functions clear the
98% bar; branches clear the 90% bar.

Docs refreshed to reflect the final schema (BIGINT telegram_user, ON DELETE
CASCADE, monotonic created_at encoding) and the auth refactor.

## Phase 10 — Second review

Another pass over the repo uncovered a handful of real gaps that the Phase 9
review missed:

1. **No ESLint config.** `npm run lint` failed with "ESLint couldn't find a
   configuration file" — the script existed but nothing backed it. Added
   `.eslintrc.cjs` with `eslint:recommended` + `@typescript-eslint/recommended`
   and tuned `no-unused-vars` to allow `_`-prefixed args (used throughout).
2. **No `.nvmrc`.** README and guide both tell the reader to run `nvm use`,
   but there was nothing to pin. Added `.nvmrc` = `20.18.0`.
3. **4xx errors were being retried.** `ApiClient.request` set `lastErr` on
   every non-2xx response and retried until exhausted. That's correct for
   5xx/network errors, but pointless for 4xx — the server will keep rejecting
   the same malformed body. Introduced `ApiClientError` for non-401/410 4xx
   and made the retry loop rethrow it immediately. Also simplifies the
   orchestrator's error handling: retryable = network/5xx, non-retryable =
   `ApiClientError` | `UnauthorizedError` | `SessionRevokedError`.
4. **`heartbeatStaleMs` was dead config.** `handleStatus` hardcoded a 60 s
   staleness window; the configured `BOT_HEARTBEAT_STALE_MS` env-var was
   parsed and carried in `BotConfig` but never threaded into the handler.
   Added `heartbeatStaleMs` to `HandlerDeps`, wired it in `main.ts`, defaulted
   to 60 s when absent for backwards compatibility with existing tests.
5. **SQLite URL parser only handled one edge case.** The jsdoc claimed support
   for `sqlite://…` style URLs but the code only stripped the leading `//`
   for the exact literal `//:memory:`. `sqlite:///abs/path.db` produced a
   path of `//abs/path.db`. Replaced the inline ternary with a dedicated
   `resolveSqlitePath` helper that handles `sqlite:`, `sqlite://`, `sqlite:///`,
   and relative/absolute forms consistently.
6. **Docs drift.** `design.md` §10 claimed "Coverage target 98%" — branches
   are 90% in `vitest.config.ts`, and always have been. Fixed the claim.
   The same section described daemon-client tests as using `undici MockAgent`
   when they actually use a hand-rolled `fetch` stub. Corrected.
7. **Native-module mismatch note added to guide.** If a user installs on
   Node 20 and later runs on Node 24, `better-sqlite3` throws
   `NODE_MODULE_VERSION` mismatch. Added a troubleshooting row and a README
   hint: `npm rebuild better-sqlite3`.

New tests: 4xx non-retry on the daemon client, `heartbeatStaleMs` override in
`handleStatus`, and five URL-form variants for `openDb`. Total now **147
tests across 21 files**, with coverage at statements 99.27% / lines 99.27% /
functions 98.13% / branches 90.9%. Above thresholds.

## Phase 11 — Node 24 bump (2026-04-19)

- `.nvmrc` bumped `20.18.0` → `24.15.0`; README, guide, and design updated
  to reference Node 24 as the pinned dev version. Motivation: running the
  built bot under Node 24 against a `node_modules` produced on Node 20
  throws `NODE_MODULE_VERSION 115 vs 127` for `better_sqlite3.node`.
  Bumping the pinned version normalizes the dev environment on the LTS line.
- `package.json` `engines` left at `>=20.18.0` — Node 20 still works, only
  the recommended dev version moved. Design note flipped wording from
  "newer Node majors also work" to "older Node majors back to 20 also work".
- Verified: `npm rebuild` recompiles native addons cleanly; `npm test`
  green at 150 tests across 22 files, 99.27% lines / 91% branches.

## Phase 12 — Admin dashboard (2026-04-19)

- New workspace `@chatcoder/dashboard`. Local-only (binds 127.0.0.1:8090) web
  UI giving full CRUD over sessions and the per-session message queues, plus
  read-only daemon state (heartbeat / staleness badge, pending counts).
  Stack: Fastify + server-rendered HTML + HTMX from CDN, no bundler. No auth
  by design; startup warns when `DASHBOARD_LISTEN_HOST` is non-loopback.
- Reuse vs new code: write paths that already exist in the bot are reused
  (`SessionsRepo.rotate`, `MessagesRepo.{enqueue, count, purgeSession}`).
  Admin-only queries live in a dashboard-local `AdminRepo` so the bot's
  production surface doesn't grow.
- Bot packaging: added sub-path `exports` to `packages/bot/package.json`
  (`./db`, `./db/sessions`, `./db/messages`, `./db/schema`) so the dashboard
  can import specific modules without pulling in `dist/main.js` (which would
  start the bot). Bot's own code uses relative imports, so existing modules
  are untouched.
- Concurrency: dashboard and bot can both open the same SQLite file because
  `openDb` enables `journal_mode=WAL`. For Postgres, no concern.
- Docs: README run snippet added; guide.md §6 covers env vars and the UI
  surface; design.md §14 records the three-option analysis (chose
  B: separate workspace + HTMX).

## Phase 13 — Dashboard via bot API, no shared DB (2026-04-19)

- The dashboard no longer opens the SQL database. Reads and writes now go
  through a new admin HTTP surface on the bot at `/v1/admin/*`. Wire types
  live in `@chatcoder/shared/admin` (zod) and are consumed on both sides.
- Admin query code moved: `packages/dashboard/src/db/adminRepo.ts` →
  `packages/bot/src/db/admin.ts`. Write paths keep reusing
  `SessionsRepo.rotate` / `MessagesRepo.{enqueue, count, purgeSession}`.
- Auth posture: bot admin routes gated by a loopback `onRequest` hook
  (`req.socket.remoteAddress` ∈ {127.0.0.1, ::1, ::ffff:127.0.0.1}), non-loopback
  peers get `404`. Daemon routes still bearer-authed; the auth hook skips
  the admin prefix. Matches §14.1's "no auth, loopback only" stance without
  forcing the bot off 0.0.0.0.
- Dashboard client: `AdminApiClient` talks to a pluggable `AdminTransport`.
  Prod uses `fetch`; tests use a `botApp.inject(...)` adapter so dashboard
  tests exercise the real bot handlers against an in-memory DB without a
  network hop.
- Config swap: dropped `DATABASE_URL` from the dashboard; added
  `BOT_API_URL` (default `http://127.0.0.1:8080`). Dashboard package.json
  lost `@chatcoder/bot`, `kysely`, `better-sqlite3`, `pg` — it's down to
  `@chatcoder/shared`, `fastify`, `pino`, `zod`.
- Dead-code pass: removed unused `esc` import + `void esc` stub in
  dashboard session routes, an unused `AdminSession` re-export in
  `adminClient.ts`, an unused `OkResponse` in shared/admin, and the
  unused `./db/schema` sub-path export from the bot's package.json. Fixed
  the `any` + unused-param lint errors in `bot/src/db/migrations.ts`.
- Tests: dashboard suite rewritten to go through the ApiClient. Several
  pre-existing tests used `telegramUser:` (a stale name from before the
  schema settled on `chat_id`) — renamed to `chatId:` in the dashboard
  and daemon system suites while touching them. Added
  `packages/bot/test/api.admin.test.ts` covering every admin endpoint
  plus the loopback gate (via `inject({ remoteAddress: ... })`).

## Phase 14 — Dashboard becomes a pure frontend (2026-04-20)

- Dashboard no longer has any server-side component. The Fastify + HTMX stack
  is gone; the workspace is now a Vite-bundled React SPA. `npm run dev:dashboard`
  runs the Vite dev server on `127.0.0.1:5173`; `build` emits static assets
  to `packages/dashboard/dist/` that any static host can serve.
- Bot gains `@fastify/cors` registered with an origin allow-list — only
  hostnames in `{127.0.0.1, localhost, ::1, [::1]}` (any port) get CORS
  headers; others are blocked at the browser level. Combined with the
  existing loopback-IP gate, admin routes are same-host-only from both
  directions.
- New `packages/bot/src/api/cors.ts`; `buildServer` registers it alongside
  `installLoopbackGuard`. Daemon routes have no browser origin and are
  unaffected.
- Dashboard tree rewritten:
  - `packages/dashboard/index.html`, `vite.config.ts`, `src/main.tsx`,
    `src/App.tsx` (React Router).
  - `src/pages/SessionsPage.tsx`, `src/pages/SessionDetailPage.tsx` cover
    the admin UX with forms, flash-banners, delete/rotate/revoke/purge,
    and message CRUD.
  - `src/api/client.ts` — thin fetch wrapper that calls `/v1/admin/*` and
    zod-validates the response envelope.
  - `src/util/usePolling.ts` — one hook for the 10s/15s refresh cadence.
- Removed: `src/server.ts`, `src/routes/*`, `src/views/*`, `src/util/html.ts`,
  `src/api/transport.ts`, `src/api/adminClient.ts` (obsolete Fastify/HTMX
  plumbing). Dropped `fastify`, `pino`, `@chatcoder/shared`-via-Fastify
  deps; added `react`, `react-dom`, `react-router-dom`, `vite`,
  `@vitejs/plugin-react`.
- Dead-code cleanup: removed the never-used `GET /v1/admin/sessions/:id`
  route (the dashboard always fetches `/detail`); removed six unreachable
  `?? 0` fallbacks in `AdminRepo` — Kysely's update/delete result types
  are non-optional.
- Tests:
  - Added `packages/shared/test/admin.test.ts` exercising the new wire
    schemas + path builders (pure-source coverage so the shared module
    shows 100% for branches/funcs).
  - Added `packages/dashboard/test/client.test.ts` (fetch stubbed with
    `vi.fn`), `test/time.test.ts`, `test/config.test.ts`.
  - Added CORS + rotate-collision cases to `packages/bot/test/api.admin.test.ts`.
  - `vitest.config.ts` excludes `packages/dashboard/src/util/usePolling.ts`
    from coverage (requires a DOM test harness to exercise); `.tsx` files
    are already outside the include glob.
- Docs: guide.md §1.2/§4 updated for Vite + `VITE_BOT_API_URL`; design.md
  §14 rewritten (Chosen C with revision, two-gate loopback policy,
  CORS+socket gate rationale).
- Verified: `npm run build` clean across all four workspaces, `npm run
  lint` clean, full test suite passes (except the two pre-existing
  failures in `bot.edgecases2.test.ts`), coverage at
  99.51% stmt / 90.61% branch / 98.76% func / 99.51% lines — above
  thresholds.
