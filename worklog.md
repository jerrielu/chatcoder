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
