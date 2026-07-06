# Changelog

## 0.3.7 (2025-07-11)

- **`npm run local` convenience script** — combines `npm run build`, `npm install -g .`,
  and `pm2 restart chatcoder-coder chatcoder-chat` into a single command. AGENTS.md
  post-change step 5 updated to use it.

## 0.3.6 (2025-07-11)

- **Exclude `.d.ts` files from git tracking** — added `*.d.ts` to `.gitignore`
  and removed all 48 tracked `.d.ts` files from the index. These are
  auto-generated build artifacts and should not be version-controlled.

## 0.3.5 (2025-07-11)

- **Summary retry message now matches normal summary message** — the retry
  summary prompt in `profileRunner.ts` and `sessionRunner.ts` now reuses the
  `SUMMARY_INSTRUCTION` constant from `toolExecutor.ts` instead of having a
  slightly different hardcoded string. This ensures consistent summarization
  behavior on the first attempt vs retries.

## 0.3.4 (2025-07-07)

- **Summary instructions now respect user language** — the summary retry prompt
  in `profileRunner.ts` and `sessionRunner.ts`, and the `SUMMARY_INSTRUCTION`
  constant in `toolExecutor.ts`, now include a directive to use the same language
  as the person being interacted with. This ensures multilingual users receive
  summaries in their own language rather than always English.

## 0.3.3 (2025-07-06)

- **Fixed: `bin/chatcoder.js` was an empty placeholder file** — commit
  `783d2d4` deleted the 205-line CLI entry point (argument parsing, package
  routing, systemd support) and added `bin/` to `.gitignore`. The subsequent
  voice-transcription commit created a 0-byte placeholder. PM2 ran the empty
  file which exited immediately, causing the coder to restart in a loop (17
  restarts) and never register/send heartbeats. Restored the full entry point
  from the previous committed version.

## 0.3.2 (2025-07-06)

- Voice message transcription using local whisper.cpp (multilingual `base`
  model). Telegram voice messages are downloaded, converted to WAV via ffmpeg,
  and transcribed locally with auto-detected language (English / Chinese).
  The transcribed text feeds into the same instruction pipeline as typed messages.
- Added `telegramBotToken` to `HandlerDeps` for constructing file-download URLs.
- Fixed workspace version mismatches in package.json files.
- Added `bin/chatcoder.js` placeholder to prevent `prepare.mjs` self-heal from
  overwriting the development checkout during `npm install`.

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
