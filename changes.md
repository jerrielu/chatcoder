# Changelog

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
