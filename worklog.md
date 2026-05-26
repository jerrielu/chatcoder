# 2026-04-25

- Added root guidance files for Codex and Claude Code instructing agents to update `worklog.md` for every repository change, grouped by date.
- Added daemon/bot support for claiming one queued instruction at a time, tracking in-progress work, resuming in-progress Codex runs after daemon restart, and completing work only after final responses post.
- Added Codex token-usage request handling, concise final-response prompting, progress-update formatting, and a shared dev runner for bot/daemon rebuild-and-restart loops.
- Updated related API, database, daemon, bot, and test coverage for the queue processing and response behavior changes; `npm run lint` and `npm run typecheck` pass. `npm test` passes all test cases but exits nonzero because current global coverage is below thresholds.
- Adjusted queue pickup so normal Code messages stay FIFO, while New Code messages preempt active work, clear older queued/in-progress work before the latest New Code item, and keep newer queued work behind it. Added a SIGKILL fallback for child processes that ignore abort SIGTERM.
- Added a Telegram acknowledgement when a queued message finishes processing, sent only after the bot clears an in-progress message, with API test coverage for acknowledgement behavior.
- Reviewed the queue preemption and in-progress resume changes; updated `design.md` and `guide.md` to document the new message lifecycle, New Code behavior, progress updates, completion acknowledgements, and related test coverage.
- Restored the New Session Telegram menu action to open a force-reply API-key input box, with a dedicated placeholder and updated callback-flow coverage.
- Added a Telegram notification when the daemon claims a queued message for processing, keeping the notification best-effort so daemon polling still returns work if Telegram sends fail.
- Added `/token` as a Telegram command that queues the same Codex token-usage request as the Token Usage menu item, with wired-bot coverage.
- Included the first 100 words of the claimed instruction in the daemon-processing Telegram notification so users can identify which message started.
- Added Telegram Code/New Code prompt recovery from replied-to bot messages so instructions still queue if in-memory flow state is lost before the user replies; verified with focused wired-bot tests, lint, and typecheck.
# 2026-04-26

- Restarted the bot and daemon services after finding they had stopped approximately 9 hours prior (logs ended around Sat Apr 25 18:13:58 UTC 2026).
- Verified that both services are currently running and logging to `nohup.out`.
- Verified that `npm run typecheck` and `npm run build` pass for the current codebase.
- Terminated all bot and daemon processes as requested.
- Added a new top-level `chatcoder` CLI (`bin/chatcoder.js`) with `chat` and `coder` subcommands that forward to the bot and daemon runtimes.
- Added `chatcoder <chat|coder> --systemd` support to write and enable per-user units (`chatcoder-chat.service` and `chatcoder-coder.service`) via `systemctl --user`.
- Updated root packaging so GitHub installs expose the `chatcoder` binary and run a runtime build on install (`prepare` + `build:runtime`).
- Updated `guide.md` and `README.md` with GitHub install, new run commands, and systemd registration usage.
- Verified with `npm run build:runtime`, `node bin/chatcoder.js --help`, and `node bin/chatcoder.js coder config-path`.
- Updated CLI routing so `chatcoder coder` runs daemon mode directly and `chatcoder coder --setup` explicitly enters profile setup mode.
- Updated daemon Codex profile home handling to seed new profile `CODEX_HOME` from existing `~/.codex/config.toml` and `~/.codex/auth.json` when profile-specific OpenAI auth/base URL is omitted, and to keep each profile's copied config/auth stable across later switches.
- Added Codex home tests covering host-copy bootstrap, sticky per-profile behavior on subsequent runs, and explicit profile auth/base URL overrides.
- Verified with `npx vitest run packages/daemon/test/codexHome.test.ts --coverage.enabled false` (pass). `npm test -- packages/daemon/test/codexHome.test.ts` still exits non-zero due global coverage thresholds.
- Changed OPENAI launch behavior so profile activation always sets scoped `CODEX_HOME` and uses the profile's presaved Codex config/auth, even when profile auth/base URL are omitted.
- Updated setup save flow to pre-create/sync OPENAI profile `CODEX_HOME` directories so adding/updating profiles immediately materializes config/auth files from host `~/.codex` or explicit profile auth/base URL values.
- Added setup/toolExecutor coverage for the new flow and verified with `npx vitest run packages/daemon/test/codexHome.test.ts packages/daemon/test/toolExecutor.test.ts packages/daemon/test/setup.test.ts --coverage.enabled false` (pass) and `npm run typecheck` (pass).
- Renamed root dev scripts to align with the chat/coder command naming: added `dev:chat` (bot workspace) and `dev:coder` (daemon workspace), while keeping `dev:bot`/`dev:daemon` as compatibility aliases.
- Updated `guide.md` daemon setup command to use `npm run dev:coder`.
- Verified script availability and mapping via `npm run`.
- Removed legacy compatibility aliases `dev:bot` and `dev:daemon`; root dev scripts now expose only `dev:chat`, `dev:coder`, and `dev:dashboard`.
- Removed workspace-level legacy bins `chatcoder-bot` and `chatcoder-daemon` so the root `chatcoder` bin is the only CLI entrypoint.
- Migrated daemon/setup and Telegram guidance text from legacy `chatcoder-daemon ...` commands to `chatcoder coder` / `chatcoder coder --setup`.
- Updated related docs (`guide.md`, `design.md`, and CLI help text) to reflect the unified `chatcoder chat|coder` command model.
- Verified with `npm run`, `npx vitest run packages/bot/test/bot.wired.test.ts packages/bot/test/bot.handlers.test.ts packages/daemon/test/setup.test.ts --coverage.enabled false`, and `npm run typecheck` (all pass).
- Updated `chatcoder <chat|coder> --systemd` installer to explicitly target the current user context (prefers `SUDO_USER` when invoked via sudo), write unit files under that user's `~/.config/systemd/user`, and run `systemctl --user` operations as that user.
- Added target-user information to systemd install output and failure hints.
- Verified with `node bin/chatcoder.js --help` and `npm run typecheck` (pass).
- Fixed git/global install lifecycle handling by replacing root `prepare` with `node scripts/prepare.mjs`, which skips workspace builds during global installs and requires prebuilt runtime artifacts.
- Committed runtime build outputs by unignoring and adding `packages/shared/dist`, `packages/bot/dist`, and `packages/daemon/dist` so global git installs no longer depend on workspace bootstrap.
- Verified with `npm run build:runtime`, `npm run prepare`, `npm_config_global=true node scripts/prepare.mjs`, and `npm install -g git+file://<temp-repo>` (install succeeded).
- Merged local `dev` into local `main` as a fast-forward (`5153f24` -> `adc7b0a`) to synchronize local branches.
- Force-pushed local `main` to `origin/main` with lease, per explicit request to make local branch content authoritative over remote divergence.

# 2026-04-27

- Changed daemon default config path from `~/.chatcoder-daemon/config.yml` to `~/.chatcoder/config.yml` in runtime path resolution.
- Updated Codex profile home root from `~/.chatcoder-daemon/codex/` to `~/.chatcoder/codex/` and aligned related guide/design references.
- Rebuilt runtime outputs with `npm run build:runtime` so committed `packages/daemon/dist/*` artifacts match source changes.
- Changed Codex scoped home layout from `~/.chatcoder/codex/<profile>/` to `~/.chatcoder/<profile>/`, so each OpenAI profile folder directly contains full `config.toml` and `auth.json` copies under `.chatcoder`.
- Added Codex home coverage asserting `codexHomeFor(name)` resolves to `~/.chatcoder/<name>`, and re-verified setup/toolExecutor/codexHome behavior with focused daemon tests.
- Identified that the environment does not use `systemd` as the init process (PID 1 is `run.sh`), causing `systemctl --user` to fail.
- Started `chatcoder chat` and `chatcoder coder` in the background using `nohup` as an alternative, then terminated them per user request.
- Added a `guide.md` PM2 section with start, status/log, restart/stop, and boot-persistence commands for running `chatcoder chat` and `chatcoder coder` without systemd.

# 2026-05-26

- Changed `chatcoder coder` default from `run` (daemon mode) to `menu` (interactive TUI).
- Changed `chatcoder` (no args) to default to the `coder` subcommand.
- Created `packages/daemon/src/menu.ts` — coder-style interactive TUI with profile list, arrow-key navigation, and actions: Activate (Enter), Add (A), Update (U), Delete (D), Run Daemon (R), Settings (S), Quit (Q).
- Created `packages/daemon/src/launcher.ts` — launches a profile's tool (claude/codex/custom) with its env vars and `inherit` stdio, returning to the menu when the tool exits.
- Added `loadRawConfig()` and `writeRawConfig()` to config.ts for TUI-friendly config loading without strict Zod validation.
- Exported coder-style UI primitives and profile editor functions from setup.ts for reuse in menu.ts.
- Added SIGINT suppression during tool activation and daemon spawning so Ctrl+C doesn't kill the menu process.
- Updated reference messages from "Start the coder service with: chatcoder coder" to "Run the daemon with: chatcoder coder run".
- Verified with `npm run build` and `npx vitest run` (308 tests pass).
- Added new Claude Code profile fields: ANTHROPIC_AUTH_TOKEN, ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, CLAUDE_CODE_EFFORT_LEVEL.
- Updated ClaudeCodeConfig zod schema, setup prompts (both coder-style and wizard), and launcher/toolExecutor env var exports for the new fields.
- Verified with `npm run build` and `npx vitest run` (308 tests pass).
- Removed `cwd` from profile schema and setup prompts — working directory is now managed globally, not per-profile.
- Updated `launcher.ts` to accept optional `cwd` parameter (defaults to `process.cwd()`).
- Updated `toolExecutor.ts` `buildLaunch()` to use `process.cwd()` instead of `profile.cwd`.
- Changed `W` menu item to manage a list of working directories (`workDirs`), with Add/Delete sub-actions.
- Working directories are only used for daemon mode, not for profile activation.
- Replaced `ANTHROPIC_API_KEY` with `ANTHROPIC_AUTH_TOKEN` as the mandatory auth field for CLAUDE_CODE profiles — removed `apiKey` from schema, made `authToken` required.
- Updated all setup prompts (coder-style and wizard), launcher, toolExecutor, tests, and profile schemas for the authToken rename.
- Verified with `npm run build` and `npx vitest run` (308 tests pass).

# 2026-04-29

- Added a Codex effort control to the Telegram main menu with a dedicated effort picker (`low`, `medium`, `high`, `xhigh`) and callbacks to update per chat/user selection.
- Wired selected effort through instruction enqueueing for OPENAI sessions only, including bot DB storage (`messages.codex_reasoning_effort`), API poll transport, daemon dispatch, and Codex launch handling.
- Added DB migration version 5 to add `codex_reasoning_effort` to `messages`, and updated shared/admin/protocol schemas and constants with `codexReasoningEffort`.
- Updated bot/daemon/shared tests to cover effort menu behavior, queue persistence, `/v1/poll` transport, and daemon executor/orchestrator propagation.
- Rebuilt `@chatcoder/shared` dist output so workspace package imports expose the new shared constants/schemas.
- Verified with:
  - `npm run build -w @chatcoder/shared`
  - `npx vitest run packages/shared/test/protocol.test.ts packages/shared/test/admin.test.ts packages/bot/test/db.messages.test.ts packages/bot/test/bot.handlers.test.ts packages/bot/test/bot.wired.test.ts packages/bot/test/api.test.ts packages/daemon/test/toolExecutor.test.ts packages/daemon/test/orchestrator.test.ts`
  - `npm run typecheck`
