# Changelog

## 0.3.2 (2025-07-06)

- Added "Coding Principles" section to `AGENTS.md` — aligns with existing
  patterns, SOLID, YAGNI, and self-review after writing.

## 0.3.1 (2025-07-06)

- `APP_VERSION` is now auto-generated from root `package.json` at build time
  via `scripts/generate-version.mjs` — single source of truth instead of a
  manually-synced hardcoded constant. The prebuild hook in `@chatcoder/shared`
  runs the generator before `tsc -b`, and the generated file is gitignored.
  (Design decision updated in `design.md §15`.)

## 0.3.0 (2025-07-06)

- `SessionsRepo.create()` now deletes **all** existing sessions for a chatId
  instead of only revoking active sessions for the same apiKeyId — starting a
  new session clears the slate for that chat entirely (previous sessions and
  their messages are cascade-deleted).

## 0.2.0 (2025-07-06)

- Added version/changelog system:
  - `APP_VERSION` constant in `@chatcoder/shared` shared across all packages
  - `changes.md` at repo root tracks changes per version
  - Telegram main menu now shows a `📦 v0.2.0` button; tapping it displays the
    latest changelog entries
  - AGENTS.md Post-Change Automation includes version bump as Step 1 and
    requires updating `changes.md` after every change
- Design decision documented in `design.md §15`.

## 0.1.0 (2025-07-05)

Initial release.

- Monorepo with workspaces: `@chatcoder/shared`, `@chatcoder/bot`, `@chatcoder/daemon`, `@chatcoder/dashboard`
- Telegram bot (grammY) with inline-keyboard menu for session management
- Long-poll daemon that spawns `codex` via PTY and streams output
- Zod-shared wire protocol, Kysely + Postgres/SQLite persistence
- Admin dashboard (React + Vite, loopback-only access)
- API key auth with SHA-256 hashing
- Heartbeat-based daemon liveness tracking
- Message queue with FIFO + preemption (New Code)
- Rate limiting (1 req/sec per session)
