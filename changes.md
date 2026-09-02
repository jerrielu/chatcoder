# Changelog

## 0.16.2 (2026-09-02)

- **Fix: Antigravity (`agy`) prompt placed immediately after `--print`** — Per requested form `agy --print "<instruction>" --model <id> --dangerously-skip-permissions .`, the instruction is now the first positional after `--print` (previously trailing after `-c`). Launches are `agy --print "<instruction>" [--model <m>] [--effort <e>] [extraArgs…] --dangerously-skip-permissions [-c] .` with `.` as the working-directory positional. (`packages/daemon/src/toolExecutor.ts`; `design.md` §7.7, `README.md`)

## 0.16.1 (2026-09-02)

- **Change: Command Code stream now returns only human-readable assistant text (`text`/`delta`)** — `packages/daemon/src/commandCodeStream.ts` previously forwarded tool lifecycle notes (`[tool: …]`), heartbeat markers (`[model_trace]`, `[api_retry]`, …), and non-JSON boot banners into both the live Telegram progress (via `onOutput`) and the in-memory snapshot that can influence the final result. The translator now only forwards the human-readable `text` (from `message_update`/`message_end` `content[].text`) and `delta` (from `text_delta`) keys — everything else (`tool_queued`/`tool_running`/`tool_update`/`tool_completed`, `run_start`/`turn_*`/`message_start`/`model_*`/`api_retry`/`thinking`, boot banners, raw JSON) is ignored. `finalize()` now falls back to the accumulated `currentText` when `result.finalText` is absent/empty so `finalText` is always the assistant text. Progress and `response.txt` now contain only the assistant's words.
  (packages/daemon/src/commandCodeStream.ts; packages/daemon/test/commandCodeStream.test.ts, toolExecutor.test.ts)

## 0.16.0 (2026-09-02)

- **Feature: Antigravity (`agy`) as a supported tool — always runs in yolo mode** — New tool kind `ANTIGRAVITY` (`agy`). Per `agy --help` the available top-level flags are `--print` (single-prompt non-interactive print mode), `--dangerously-skip-permissions` (auto-approve all tool permission requests), `--model`, `--effort` (`low|medium|high`), `--continue`/`-c` (continue most recent conversation), etc. Supported launches are `agy --print --dangerously-skip-permissions [--model <m>] [--effort <e>] [extraArgs…] [-c] "<instruction>"`; `--dangerously-skip-permissions` is forced after `extraArgs` (mirroring the `cmd --yolo` / `reasonix --permission-mode auto` guarantee) so it cannot be disabled per profile, and `-c` is appended when `resumeLastSession=true` (the same signal the other tools gate on). Profile config is `{ model?: string, effortLevel?: string, extraArgs: string[] }`. Wizard (TTY `pickTool` + `promptAntigravity` and non-TTY `promptOneProfilePromptWizard`) now offer "Antigravity (agy)" alongside the other tools, the Telegram `toolIcon` for it is `🟠`, and the daemon's `ProfilesTable` type accepts the new kind. `agy --help` excerpt: `--dangerously-skip-permissions`, `--print`, `--model`, `--effort`, `-c/--continue`.
  (packages/shared/src/constants.ts; packages/daemon/src/profile.ts, toolExecutor.ts, launcher.ts, setup.ts; packages/bot/src/bot/menus.ts, db/schema.ts)

## 0.15.6 (2026-09-01)

- **Fix: stuck “🔄 processing…” now auto-releases via per-task heartbeat lease (30s/60s) — removes the continue-flood wrong fix** — The session wedge is that `messages.processing_started_at IS NOT NULL` is a per-session mutex: `claimNext` blocks and `GET /v1/poll` omits the session until `completeProcessing` deletes the row. One stuck task (hung `cmd` child still alive, or swallowed `POST /v1/responses {final:true}` with `tryPostChunked()=false`) therefore blocks every later message, while `staleSweep` (60s per-daemon `last_heartbeat`) never fires because the daemon is alive and heartbeating. `pm2 restart` fixed it only because the first poll used `resumeInProgress=1` to synthesize `continue` for the same row. `c48e53e`/`5ad5c06` tried to auto-heal with a per-runner `pendingFinalAck` → per-poll `resumeInProgress=1` → enqueued synthetic `continue` per poll, which flooded normal long tasks with spurious `cmd -c "continue"` turns and leaked across sessions. This replaces it with a lease: new column `messages.processing_heartbeat_at` set atomically on `claimNext`/`claimStop`, bumped every 30s by the daemon while `tool.execute` is alive via new `POST /v1/task-heartbeat {sessionId, messageId}` (independent of stdout, best-effort, timer cleared on settle), and expired by the bot when `now - heartbeat > 60s` — inline in `GET /v1/poll` (delete via `completeProcessing` so FIFO can claim the next pending item) and every 30s via new `sweepExpiredLeases` (covers sessions not polled). `pendingFinalAck`/`hasPendingFinalAcks` and the every-poll `resumeInProgress` gate are deleted; only the first-poll `shouldResumeInProgress` (bot-restart bootstrap) is kept. Two pre-existing failures on `main` (`GET /v1/poll replaces in-progress…` expects unimplemented new-code preemption; `POST /v1/responses does not send processed…` expects `sendProcessed` not called) are corrected in tests. 357/357 pass.
  (packages/shared/src/constants.ts, protocol.ts; packages/bot/src/db/schema.ts, migrations.ts:8, messages.ts, api/server.ts, staleSweep.ts, main.ts, db/admin.ts; packages/daemon/src/client.ts, sessionRunner.ts, sessionManager.ts, orchestrator.ts, main.ts; packages/bot/test/api.test.ts; packages/daemon/test/sessionRunner.test.ts, orchestrator.test.ts)

## 0.15.5 (2026-08-31)

- **Fix: pendingFinalAck no longer triggers spurious "continue" resume floods on
  the happy path** — The 0.15.4 self-heal mechanism (`pendingFinalAck` set at
  the start of every non-stop task, cleared when the final POST succeeds)
  accidentally turned the orchestrator's `resumeInProgress=1` gate on for the
  ENTIRE duration of a normal task. With the daemon polling every few seconds
  while the user is waiting on cmd to finish a long task, every poll saw
  `pendingFinalAck=true`, asked the bot to resume the in-progress row, the bot
  handed back a synthetic `continue` task, and the daemon enqueued it. After
  the original task completed, the runner FIFO-drained the queued "continue"
  tasks — each one ran `cmd -c "continue"` and posted its output back to the
  user, producing a flood of spurious "continuing the conversation" replies.
  Fix: `pendingFinalAck` is now set to `true` ONLY when a final POST actually
  fails (the rare wedge-recovery case), and cleared when the next final POST
  succeeds. The happy path leaves the flag at `false`, so the orchestrator
  stops sending `resumeInProgress=1` and the bot's normal FIFO claim flow
  takes over. Stop tasks remain unaffected (the abort path is its own
  confirmation). 5/5 sessionRunner tests pass; full daemon suite 131/131;
  full repo suite 358/360 (the 2 pre-existing bot/api failures are unrelated
  to this change, confirmed by stashing and re-running on the base branch).
  (packages/daemon/src/sessionRunner.ts, packages/daemon/test/sessionRunner.test.ts,
  packages/daemon/test/orchestrator.test.ts)

## 0.15.4 (2026-08-30)

- **Fix: stuck "🔄 processing…" no longer blocks subsequent messages for the
  session** — When the daemon's final POST to the bot fails (timeout, 5xx,
  network) and `tryPostChunked` swallows the error, the daemon's
  `SessionRunner` previously thought the task was done and returned to idle,
  but the bot's `messages.processing_started_at` was never cleared (because
  `completeProcessing` only runs on a successful POST). The bot's `GET
  /v1/poll` handler then refused to surface any new work for the session as
  long as the in-progress row remained (server.ts:135-159), and the daemon
  never asked it to (the existing `shouldResumeInProgress` flag is only set
  to `true` on the very first poll after startup, then permanently flipped
  off — orchestrator.ts:109-112). Result: every subsequent user message
  for that session sat in the DB queue and the user had to PM2-restart the
  services to recover. The fix tracks a per-runner `pendingFinalAck` flag
  in `SessionRunner` that is set when a non-stop task starts and cleared
  the moment the final POST succeeds (returns from `tryPostChunked` without
  throwing). `SessionManager.hasPendingFinalAcks()` exposes whether any
  runner still has a pending ack, and the Orchestrator now sends
  `resumeInProgress=true` on every poll while at least one runner's
  `pendingFinalAck` is set. The bot hands back the same in-progress row
  with `content: "continue"` and `resumeLastSession: true`; the daemon
  re-runs the task; on the next successful final POST `pendingFinalAck`
  clears, `completeProcessing` runs on the bot, the wedge is gone, and the
  queue drains FIFO as normal. Stop tasks deliberately do not set the
  flag (the abort path is its own confirmation). End-to-end unit tests
  cover: pendingAck flips on at task start, flips off on successful
  final, stays on when the final throws, stop tasks do not set it, and
  recovery after a transient failure. 16/16 new + modified tests pass
  (full suite: 358/360, the 2 pre-existing bot/api failures are
  unrelated to this change).
  (packages/daemon/src/sessionRunner.ts, sessionManager.ts, orchestrator.ts;
  packages/daemon/test/sessionRunner.test.ts, orchestrator.test.ts)

## 0.15.3 (2026-08-30)

- **Fix: Command Code (`cmd`) "🔄 processing…" message no longer freezes during
  model thinking** — `packages/daemon/src/commandCodeStream.ts` was silently
  dropping every NDJSON event type other than `text_delta` / `message_update` /
  `tool_*` / `run_end`, so during the model-thinking phase (between
  `model_request_start` and the first `text_delta`, sometimes 30+ seconds for
  long tool calls or model retries) the Telegram "🔄 processing…" message
  stayed at whatever was last emitted. The translator now surfaces all event
  types as progress: known content events still drive `currentText` /
  `toolSuffix` exactly as before; the meta events `run_start`, `turn_start`,
  `turn_end`, `message_start`, `model_request_start`, `model_request_end`,
  `model_trace`, `api_retry`, `thinking` (and any future event type via the
  `default:` branch) are surfaced as a deduplicated heartbeat suffix like
  `\n[model_trace]` so the user sees cmd is alive while it is thinking. The
  `tool_update` event is mapped to a `[tool: <name> running]` note, matching
  the existing tool-running format. The heartbeat suffix is automatically
  cleared the moment a real `text_delta` or `message_update` arrives so it
  does not linger once real content starts flowing. Internally the
  single-suffix state was split into independent `heartbeatSuffix` and
  `toolSuffix` slots so changing one no longer clobbers the other. End-to-end
  test mirrors the real `cmd` event sequence observed in the wild.
  (packages/daemon/src/commandCodeStream.ts,
  packages/daemon/test/commandCodeStream.test.ts — see design.md §7.6)

## 0.15.2 (2026-08-30)

- **Force `--max-turns 999999999` on every Command Code (`cmd`) tool launch** —
  Every daemon tool invocation for a `COMMAND_CODE` profile now appends
  `--max-turns 999999999` after the profile's `extraArgs`, so long-running
  tasks are never cut off mid-turn by Command Code's default agent-turn cap.
  The flag is forced (mirroring the Reasonix `--permission-mode auto` and the
  `--yolo` / `--output-format json` "always-on" patterns in the same branch),
  so a profile's own `extraArgs` cannot override it. The interactive
  `chatcoder coder` TUI launcher is unchanged. (packages/daemon/src/toolExecutor.ts;
  packages/daemon/test/toolExecutor.test.ts — see design.md §7.6)

## 0.15.1 (2026-08-28)

- **`response.txt` now includes the in-progress stream alongside the final
  answer** — The bot's `sendProcessed` (`packages/bot/src/main.ts`) concatenates
  the live `state.progress` (the text that was edited into the "🔄 processing"
  message during the run) with the final `state.response` before writing the
  `response.txt` document. Previously the document only contained the final
  text, so users running a streaming provider like Command Code (`cmd`) saw the
  same final text twice — once in the new Telegram message and once in the
  document's caption. Now the document is a consolidated record of the whole
  turn (progress notes + final answer) and the visible Telegram surface for one
  run is just: the live "🔄 processing" message (edited as progress streams in)
  + the new final-response message + the single `response.txt` document. No
  daemon or wire-protocol changes were required. (packages/bot/src/main.ts —
  see design.md §3)

## 0.15.0 (2026-08-28)

- **Typing `resume` (or `continue` / `cont` / `res`) in the Telegram chat now
  behaves like tapping the 💻 Code menu button** — The `message:text` handler
  gains a new `isResumeKeyword()` predicate that matches a bare resume
  keyword while the user is idle. When matched, the bot sets the flow to
  `awaiting_instruction` with `resumeLastSession: true` and replies with
  the same force-reply `Code (resume)` prompt the menu button sends. The
  user's next message is then launched by the daemon with resume-mode
  enabled, which means the `cmd` binary receives `-c` (and the other tool
  backends receive their equivalent continue flag). This avoids forcing
  users to scroll up to the menu when they want to continue a session —
  they can just type `resume` and hit enter. No daemon or wire-protocol
  changes were required. (packages/bot/src/bot/bot.ts;
  packages/bot/test/bot.edgecases.test.ts — see design.md §5)

## 0.14.0 (2026-08-28)

- **Command Code (`cmd`) now streams live progress to Telegram and resolves
  with a clean final answer** — The `COMMAND_CODE` provider launches
  `cmd -p --yolo --output-format json …` and a new
  `packages/daemon/src/commandCodeStream.ts` translator parses the NDJSON
  event stream: `text_delta` / `message_update` events become live progress
  forwarded to `onOutput` (so the bot's "🔄 processing…" message keeps
  ticking like Reasonix does), `tool_queued` / `tool_completed` events become
  short `[tool: <name>]` notes, and the terminal
  `{"type":"result",…,"finalText":"…"}` line becomes the resolved output.
  Before this, the daemon saw no stdout until cmd was done, so users got a
  frozen "🔄" message and `response.txt` ended up with whatever leaked
  through — behaviour now matches the Reasonix provider. The interactive
  `chatcoder coder` TUI launcher is unchanged (still plain text).
  (packages/daemon/src/commandCodeStream.ts, toolExecutor.ts;
  packages/daemon/test/commandCodeStream.test.ts, toolExecutor.test.ts —
  see design.md §7.6)

## 0.13.2 (2026-08-28)

- **Remove effort adjustment from the Command Code (`cmd`) provider** — The
  per-instruction `codexReasoningEffort` override is now ignored for
  `COMMAND_CODE` profiles, the profile-level `effort` field is gone, and
  `cmd --effort <level>` is never emitted on launch. The setup wizard (both
  Coder-style and prompt-wizard paths) no longer asks for an effort preset for
  `COMMAND_CODE` profiles — only the model id. Existing `config.yml` profiles
  keep their `effort` value in the file (the schema stops reading it on parse),
  so no manual migration is required. The unused `COMMAND_CODE_EFFORTS` and
  `CommandCodeEffort` exports were also dropped from `@chatcoder/shared`. This
  reflects that Command Code's per-request effort knob is set by the upstream
  provider and not something the daemon should be overwriting.
  (packages/daemon/src/profile.ts, setup.ts, toolExecutor.ts, launcher.ts;
  packages/daemon/test/profile.test.ts, toolExecutor.test.ts;
  packages/shared/src/constants.ts — see design.md §7.6)

## 0.13.1 (2026-08-28)

- **Revert: Command Code auto-discovery and `cmd+<model>` profile generation**
  — The 0.13.0 behaviour of running `cmd --list-models` on every daemon start
  and materialising one auto-profile per discovered model is removed. Profiles
  are now a static, user-authored set: the setup wizard asks for the model id
  as free text (with a hint to consult `cmd --list-models`) and an effort
  preset, and that's what gets saved to `config.yml`. No `commandCodeModels`
  cache file is read or written any more.
  (packages/daemon/src/commandCodeModels.ts deleted,
  packages/daemon/src/main.ts, setup.ts; packages/shared/src/protocol.ts)
- **Profile names no longer allow `+`** — The `+` exception existed only to
  support the now-removed `cmd+<model>` auto-naming. Slug rules revert to
  letters / digits / `_` / `.` / `-`.
  (packages/shared/src/protocol.ts, packages/daemon/src/profile.ts, setup.ts)
- **`MAX_PROFILES_PER_DAEMON` lowered 96 → 32** — the headroom was only
  needed for the auto-generated `cmd+` set; 32 is plenty for user-authored
  profiles.
  (packages/shared/src/constants.ts)

## 0.13.0 (2026-08-23)

- **Feature: Command Code (`cmd`) is now a supported tool provider with
  auto-generated `cmd+<model>` profiles** — On every daemon start the daemon
  runs `cmd --list-models`, and every discovered model automatically becomes a
  selectable profile named `cmd+<modelname>` (e.g. `cmd+gpt-5.6-terra`,
  `cmd+Qwen_Qwen3.8-Max`), refreshed on each restart: models added upstream
  appear, removed ones disappear. User-authored profiles are never touched.
  Auto profiles live in memory only — `config.yml` keeps just the manual ones.
  Launches run headless and always non-interactive:
  `cmd -p --yolo -c --model <m> [--effort <e>] "<instruction>"`; `--yolo` is
  forced (mirrors the REASONIX forced `--permission-mode auto`).
  (packages/daemon/src/commandCodeModels.ts, main.ts, toolExecutor.ts,
  launcher.ts)
- **Feature: reasoning-effort presets for Command Code** — The Telegram
  effort picker now also applies to COMMAND_CODE profiles (per-instruction
  override, reusing the existing `codexReasoningEffort` wire field — no new
  protocol). Manual wizard profiles can bake a fixed preset
  (`low/medium/high/xhigh/max`, incl. `max` which the Telegram picker doesn't
  expose) via "Command Code (cmd)" → model picker (from the discovered list)
  + effort picker.
  (packages/bot/src/bot/handlers.ts, packages/daemon/src/setup.ts,
  packages/shared/src/constants.ts)
- **Profile names now allow `+`** — required by the `cmd+<model>` naming;
  slug rules otherwise unchanged (spaces still rejected).
  (packages/shared/src/protocol.ts, packages/daemon/src/profile.ts,
  packages/daemon/src/setup.ts)
- **`MAX_PROFILES_PER_DAEMON` raised 32 → 96** — the Command Code catalog
  (~50 models) plus manual profiles would exceed the old cap.
  (packages/shared/src/constants.ts)

## 0.12.6 (2026-08-20)

- **Fix: bot fails to start on Node ≥24 with `Could not locate the bindings
  file` (better-sqlite3)** — The pinned `better-sqlite3@^11.0.0` / `^11.10.0`
  does not ship a prebuilt native binary for Node 24, and the host has no C/C++
  compiler to build from source, so `openDb()` threw at startup and crashed the
  `chatcoder-chat` process. Bumped to `better-sqlite3@^13.0.0` (engines
  `>=22`, prebuilt available for Node 24). The bot only uses the standard
  constructor + `pragma` API, which is unchanged in v13. Verified the native
  binding loads and the bot reaches "bot long-polling started".
  (packages/bot/package.json, packages/daemon/package.json)

## 0.12.5 (2026-08-20)

- **Fix: bot no longer crashes on startup when `whisper-node` is not installed**
  — `packages/bot/src/bot/transcription.ts` resolved the whisper.cpp path
  eagerly at module top-level via `realpathSync`. Because the bot imports that
  module unconditionally, a missing (or not-yet-built) `whisper-node`
  dependency threw `ENOENT` and took down the entire `chatcoder-chat` process
  — breaking text commands, the menu, etc., not just voice transcription.
  Resolution is now lazy and non-fatal: a new `isTranscriptionAvailable()`
  guard lets import succeed, and `transcribeAudio()` warns and returns `""`
  when the optional dependency is absent. The voice handler now tells the user
  transcription is unavailable instead of a misleading "could not transcribe"
  message. (packages/bot/src/bot/transcription.ts, packages/bot/src/bot/bot.ts)
- **Fix: removed `MODULE_TYPELESS_PACKAGE_JSON` reparse warning for
  `bin/chatcoder.js`** — The root `package.json` had no `"type"` field, so Node
  reparsed the ESM CLI entry point as a module with a performance overhead
  warning. Added `"type": "module"` (all root `.js` files are already ESM and
  none use `require()`). (package.json)

## 0.12.4 (2026-08-20)

- **Fix: `npm install` (and `build:runtime`/`typecheck`) no longer fails with
  `TS2307: Cannot find module './generated-version.js'`** — The shared package's
  `APP_VERSION` is generated at build time into the gitignored
  `packages/shared/src/generated-version.ts`, but generation only ran via the
  `shared` npm `prebuild` hook. The root `build:runtime` and `typecheck` scripts
  called `tsc -b` directly, bypassing that hook, so the file was never created
  and `tsc` could not resolve the import. Since `npm install` → `prepare` →
  `build:runtime` uses the same direct `tsc -b`, the install itself broke. Added
  an explicit `generate-version` root script and run it before both `tsc -b`
  invocations so the generated file always exists before compilation.
  (package.json)

## 0.12.3 (2026-08-19)

- **Feature: `npm run pm2:start` runs both services under PM2 with one
  command** — Builds the release artifacts and starts (or restarts, if the
  processes already exist) `chatcoder-chat` and `chatcoder-coder` as PM2
  processes, launched from the repo-local `bin/chatcoder.js` so they run the
  compiled `dist` output, then saves the PM2 process list. Idempotent: starts
  new instances or restarts existing ones.
  (package.json, scripts/pm2-start.mjs)

## 0.12.2 (2026-08-19)

- **Fix: `npm install` no longer fails with `404 Not Found - GET
  https://registry.npmjs.org/@chatcoder%2fshared`** — The `bot`, `daemon` and
  `dashboard` workspaces declared `@chatcoder/shared` as version `0.1.0`, but
  the actual local workspace package is versioned with the monorepo (currently
  `0.x.y`). Because `0.1.0` could not match the local workspace package, npm
  fell back to fetching it from the registry — where it does not exist (it's a
  private workspace package), producing the 404. The references now pin the
  workspace package version so npm links `node_modules/@chatcoder/shared`
  locally via a symlink and never touches the registry. Note: this environment's
  npm does not support the `workspace:*` protocol, so the matching-version pin
  is used instead; keep the `@chatcoder/shared` reference in sync with the
  workspace version on every bump.
  (packages/bot/package.json, packages/daemon/package.json,
  packages/dashboard/package.json, package-lock.json)
- **Fix: dashboard production build was failing** — `src/config.ts` uses
  `import.meta.env`, which requires Vite client types that were missing from
  the dashboard tsconfig, so `npm run build` (and thus `npm start`) errored
  with `TS2339: Property 'env' does not exist on type 'ImportMeta'`. Added
  `"types": ["vite/client"]` to `packages/dashboard/tsconfig.json`.
- **Feature: `npm start` now builds and runs the release version of both
  services** — Adds a root `start` script that runs `npm run build` and then
  launches the `chat` (bot API, port 8080) and `coder --daemon` services from
  their built `dist` artifacts concurrently, forwarding SIGINT/SIGTERM to both.
  (package.json, scripts/start.mjs)

## 0.12.1 (2026-08-15)

- **Reasonix profiles now always run with auto permission mode** — Every
  reasonix launch (`reasonix run ...` for daemon sessions, `reasonix ...` for
  interactive TUI launches) now appends `--permission-mode auto` after the
  profile's `extraArgs`, so the mode cannot be overridden per-profile and the
  `extraArgs: ["--permission-mode", "auto"]` workaround is no longer needed in
  `~/.chatcoder/config.yml`. Auto mode auto-approves ordinary writer fallbacks
  while still asking for genuinely risky operations.
  (packages/daemon/src/launcher.ts, packages/daemon/src/toolExecutor.ts,
  packages/daemon/test/toolExecutor.test.ts — see design.md §reasonix-auto-mode)

## 0.12.0 (2026-08-06)

- **Feature: on stall timeout the task is now killed AND relaunched under the
  same session** — Previously (0.10.0) a stalled tool process was killed and
  the task failed with an error. Now the same task is automatically relaunched
  (same message, same resume flags) so progress keeps updating under the same
  session, up to `stallRetries` times (default 3, configurable in
  `config.yml`, `0` disables the relaunch = old behaviour) before it finally
  fails with a clear error.
  (packages/daemon/src/toolExecutor.ts, packages/daemon/src/config.ts,
  packages/daemon/src/main.ts)
- **Fix: killing a stale tool now kills its whole process tree** — Tool CLIs
  are two-level (a node wrapper that spawns the real binary); killing only the
  direct child orphaned the binary, which is how frozen tasks kept running
  after restarts. Tool children are now spawned `detached` (process-group
  leader) and all kill paths (stall watchdog, abort, shutdown, startup sweep)
  kill the whole group via `kill(-pid)`.
  (packages/daemon/src/toolExecutor.ts, packages/daemon/src/daemonState.ts,
  packages/daemon/src/main.ts)

## 0.11.0 (2026-08-06)

- **Feature: "if something is stale, kill it and rerun it"** — a hung or
  orphaned daemon/task can no longer freeze a session forever. Four pieces:
  - **Daemon single-instance registry** (`packages/daemon/src/daemonState.ts`):
    a `~/.chatcoder/daemon-state.json` records the current daemon PID and the
    PIDs of its tool children. On startup the daemon kills any previous daemon
    and any leftover tool processes (the orphaned reasonix/claude/codex
    processes that froze progress and burned CPU), then claims sole ownership.
    On exit (SIGINT/SIGTERM, plus a sync `process.on("exit")` fallback) it
    kills its registered tool children and clears the registry.
  - **Periodic self-sweep**: every 60s the daemon checks it is still the only
    instance (if superseded it kills its children and exits) and prunes dead
    tool PIDs from the registry.
  - **CLI wrapper signal forwarding** (`bin/chatcoder.js`): the wrapper now
    spawns the daemon/bot as an async child and forwards SIGINT/SIGTERM, so a
    PM2/systemd restart kills the whole tree instead of orphaning the child —
    that orphaning was the root cause of the frozen progress messages.
  - **Bot stale-task sweep** (`packages/bot/src/staleSweep.ts`): every 60s the
    bot kills in-progress rows whose daemon stopped heartbeating
    (`heartbeatStaleMs`, default 60s) and **re-queues the instruction** so it
    reruns when a daemon reconnects; the user gets a plain-text Telegram
    notice. This is the safety net for a daemon crash, where the v0.10.0 stall
    watchdog (which only runs while the daemon is alive) can't help.
- Fixes the observed production incident: 4 orphaned daemons (ppid 1) running
  pre-watchdog code + 4 orphaned reasonix children (2 of them duplicating the
  same task at ~90% CPU each) froze the game session's progress message and
  pushed host load to ~7.5. All 8 stale processes were killed; the registry +
  sweep prevent recurrence.

## 0.10.0 (2026-08-06)

- **Fix: progress updates no longer freeze forever when a task stalls** — The
  daemon's `ToolExecutor` waited indefinitely for the child process (reasonix /
  claude / codex / custom) with no way to detect a hang. If the provider call
  or network stalled, the child produced no output, so the progress message in
  Telegram froze at the last chunk and the task stayed in-progress forever,
  blocking the session. Added a **stall watchdog**: if the child emits no
  output for `stallTimeoutMs` (default 15 min, configurable in `config.yml`,
  `0` disables), it is killed (SIGTERM → SIGKILL) and the task completes with
  a clear error instead of hanging silently. (packages/daemon/src/toolExecutor.ts,
  packages/daemon/src/config.ts, packages/daemon/src/main.ts)
- **Fix: resumed tasks show live progress again after a bot restart** — The
  "processing" message and its edit state live in the bot's memory, so after a
  bot restart a resumed in-progress task had no progress message and all
  progress updates were silently dropped (the old message stayed stale on
  screen). The server now re-creates the processing notification with the
  original instruction on resume, and the bot skips it when it already has
  state (daemon-only restart), avoiding duplicates.
  (packages/bot/src/api/server.ts, packages/bot/src/main.ts)

## 0.9.4 (2026-07-29)

- **Fix: final response now sent as a new single message instead of editing the
  processing/progress message** — Previously, `sendResponse` edited the "processing"
  Telegram message in-place to inject the final response, which meant the progress
  updates were lost once the response appeared. Now the final response is sent as a
  **brand new message**, leaving the progress message untouched. If the response
  exceeds Telegram's 4096-char limit, it is truncated with a pointer to
  `response.txt` for the full text. The `response.txt` document attachment
  (`sendProcessed`) is unaffected. (packages/bot/src/main.ts)

## 0.9.3 (2026-07-29)

- **Fix: daemon HTTP requests now have a configurable timeout (default 30s)** —
  `ApiClient.request()` (used by poll, postResponse, and heartbeat) had **no
  timeout on fetch**, causing HTTP calls to hang indefinitely when the bot API
  was briefly unreachable or a TCP connection stalled. This triggered two
  cascading failures: (1) `flushInFlight` in `SessionRunner.executeWithOutputUpdates`
  got permanently stuck at `true`, silently dropping all subsequent progress
  updates for the current task; (2) `Orchestrator.tickPoll()` never completed,
  preventing any future poll cycles and starving the daemon of new work. Both
  progress updates and new task processing stopped simultaneously until the
  daemon was restarted. Fixed by adding an `AbortController` with a configurable
  `timeout` (default 30 s, `ApiClientOptions.timeout`) to every HTTP request,
  with the timer always cleaned up via `finally`. Additionally, the progress-flush
  loop now has a safety timer (`updateMs * 2`) that releases `flushInFlight` even
  if the HTTP call stalls beyond the request timeout, providing defense in depth.
  (packages/daemon/src/client.ts, packages/daemon/src/sessionRunner.ts)

- **Bugfix: `response.txt` no longer truncated for large Reasonix responses** —
  When a final response exceeded 32 KB the daemon split it into chunks and sent
  all but the last as progress updates, so only the final ~3.5 KB reached
  `response.txt`. Fixed by (a) raising `MAX_RESPONSE_BYTES` from 32 KB to
  512 KB so most responses arrive as a single chunk, and (b) making the last
  oversized-final chunk carry the **full** text instead of just the last slice.
  The Fastify `bodyLimit` was also raised from 64 KB to 1 MB to match.
  (packages/shared/src/constants.ts, packages/daemon/src/sessionRunner.ts,
  packages/daemon/src/profileRunner.ts, packages/bot/src/api/server.ts)
- **Enhancement: Telegram message body now shows tail of oversized responses** —
  When the final response exceeds Telegram's 4096-character message limit, the
  edited processing message now displays the **last portion** of the response
  with a truncation notice, instead of silently failing the edit. The full text
  is always available via `response.txt`.
  (packages/bot/src/main.ts)

## 0.9.1 (2026-07-27)

- **Bugfix: Profile switch via Telegram menu now propagates to the daemon** —
  When changing profiles through the Telegram Profile menu, the session's
  `profile_id` was correctly updated in the database and the poll response
  returned the new profile name, but the daemon's `SessionManager` held on to
  the old `SessionRunner` with the stale profile configuration. The runner now
  updates its profile reference when it differs from the one passed by the
  orchestrator, so subsequent instructions use the correct tool config (env
  vars, model, CLI args, etc.).
  (packages/daemon/src/sessionRunner.ts, packages/daemon/src/sessionManager.ts)

## 0.9.0 (2026-07-27)

- **Feature: New Code (with Review) now queues two separate instructions** —
  Instead of composing a single combined prompt, the review flow now first queues
  the user's instruction as a fresh run, then queues a separate review instruction
  that asks the AI to review the output and fix all issues found. This gives the
  AI a clear two-step workflow: implement first, then review+fix.
  (packages/bot/src/bot/handlers.ts)
- **Menu: 🔬 New Code + Review moved to its own row** — The review button now
  sits alone on the second row of the Telegram inline keyboard, visually
  separated from "💻 Code" and "🆕 New Code" on row 1.
  (packages/bot/src/bot/menus.ts)

## 0.8.0 (2026-07-27)

- **Feature: New Code (with Review) menu item** — Added `🔬 New Code + Review`
  button to the Telegram main menu. When tapped, it prompts the user for an
  instruction, then automatically composes a combined prompt that performs a
  deep code review on the previous commit and uncommitted changes (checking
  SOLID principles and user requirements) before executing the instruction.
  Flows through the existing `awaiting_instruction` state with a new `review`
  flag. (packages/bot/src/bot/flows.ts, menus.ts, handlers.ts, bot.ts)

## 0.7.11 (2026-07-11)

- **Fix: folder picker menu alignment** — The `« Menu` (返回菜单) button in the
  folder picker now appears on its own row, aligned with the folder options above,
  instead of sharing a row with "Use default". (packages/bot/src/bot/menus.ts)

## 0.7.10 (2026-07-11)

- **Fix: response.txt only contained the last chunk of the execution log** —
  Commit `f5e6c17` (v0.7.8) lowered the single-shot threshold for final responses
  from the server's Zod limit (32KB) to chunkMax (4095 chars), causing any
  response over 4095 chars to be split into chunks with only the last chunk sent
  as `{final: true}`. The bot accumulated only final chunks into `state.response`,
  so the downloadable `response.txt` file contained only the last ~4KB instead of
  the full log. Restored the single-shot threshold to `MAX_RESPONSE_BYTES` (32KB)
  so responses under 32KB are sent in one request and the full content reaches
  `response.txt`. Progress-update chunking (for Telegram display) remains at
  chunkMax. (packages/daemon/src/sessionRunner.ts, packages/daemon/src/profileRunner.ts)
- **Display chunk size reduced from 4095 to 3500** — Telegram message text limit
  is 4096 characters; lowered chunkMax to 3500 to leave room for Telegram's
  markup overhead and avoid silent truncation of the last chunk.
  (packages/daemon/src/sessionRunner.ts, packages/daemon/src/profileRunner.ts)

## 0.7.9 (2026-07-11)

- **Fix: New Code tasks in the middle of the queue were silently deleted** —
  `claimLatestNewCodeAndClearBefore` deleted ALL older pending messages when
  claiming the latest New Code, including other pending New Code tasks. Fixed by
  restricting the delete to only non-New-Code instructions (`resume_last_session = 1`),
  so multiple New Code tasks all execute in order (newest-first) instead of
  having the middle ones silently skipped. (packages/bot/src/db/messages.ts)

## 0.7.8 (2026-07-10)

- **Fix: oversized final responses and empty output blocking task completion** —
  When a final response exceeded 32KB, the daemon sent it in one shot and the
  server rejected it with a validation error, leaving the task stuck as
  "in-progress" forever. The initial fix (staging as a progress update) failed
  because progress updates also have the same 32KB server-side limit. Now
  properly handled by chunking oversized content at chunkMax (4095 chars):
  first N-1 chunks sent as progress updates (final:false), last chunk as
  the actual final (final:true). Each chunk is well within the 32KB limit.
  (packages/daemon/src/sessionRunner.ts, packages/daemon/src/profileRunner.ts)
- **Fix: error responses now complete the task** — The error handler in runOne
  was sending the error message without `{ final: true }`, so the bot treated
  it as a progress update and never called completeProcessing, leaving the
  task stuck. (packages/daemon/src/sessionRunner.ts,
  packages/daemon/src/profileRunner.ts)
- **Fix: empty output no longer hangs the queue** — When the tool produced no
  output, executeWithOutputUpdates exited early without sending any response
  to the server, leaving the task stuck. Now sends "(no output)" as a final
  response to trigger completion. (packages/daemon/src/sessionRunner.ts,
  packages/daemon/src/profileRunner.ts)

## 0.7.7 (2026-07-10)

- **Fix: second request's "Latest Progress" not updating** — When two new code
  requests are queued, the first request's progress updated correctly but the
  second's was silently dropped. A race condition in `POST /v1/responses` deleted
  the in-progress DB row before cleaning up the in-memory `ProcessingState` map,
  allowing a concurrent poll to claim the next task and overwrite the map entry.
  Fixed by calling `sendProcessed` (which cleans the map) before
  `completeProcessing` (which deletes the DB row). (packages/bot/src/api/server.ts)

## 0.7.6 (2026-07-10)

- **response.txt caption now shows truncated preview** — The document message
  includes the first 1000 characters of the response as its caption, so the
  user can read the gist directly in the chat without downloading the file.
  (packages/bot/src/main.ts)

## 0.7.5 (2026-07-10)

- **Fix Reasonix final response truncated to last paragraph** — Removed
  `extractLastBlock()` which was discarding all but the last paragraph of
  tool output. The final response now uses the full raw output, so
  `response.txt` contains the complete Reasonix conversation instead of just
  the last block. Codex JSON output extraction is preserved.
  (packages/daemon/src/sessionRunner.ts, packages/daemon/src/profileRunner.ts,
  packages/daemon/src/summary.ts)

## 0.7.4 (2026-07-10)

- **response.txt now contains only the final response** — Removed the Message
  and Progress sections from the downloaded log file; it now holds just the
  final AI response (MarkdownV2 escapes stripped). (packages/bot/src/main.ts)

## 0.7.3 (2026-07-10)

- **Rename response.md → response.txt** — Changed the downloaded log filename
  from `response.md` to `response.txt` so it opens in a text editor by default
  instead of rendering as Markdown. (packages/bot/src/main.ts)

## 0.7.2 (2026-07-10)

- **Fix response.md encoding** — Added UTF-8 BOM (Byte Order Mark) to the
  response.md attachment so viewers/editors correctly detect UTF-8 encoding
  instead of misinterpreting Chinese characters as Latin-1. (packages/bot/src/main.ts)

## 0.7.1 (2026-07-09)

- **response.md now contains all state (message + progress + response) as clean
  Markdown** — Replaced the rawContent approach with a simpler solution: the bot
  builds the .md from its existing ProcessingState (preview, progress, response)
  and strips MarkdownV2 escape characters so the file is readable Markdown.
  (packages/bot/src/main.ts, packages/bot/src/bot/telegramSend.ts)
- **Fix profileRunner final response truncation** — The profile runner was
  chunking final responses at 4095 chars, causing `completeProcessing` to
  destroy the processing state after the first chunk. Final responses are now
  sent in a single HTTP request, matching the sessionRunner behavior.
  (packages/daemon/src/profileRunner.ts)

## 0.7.0 (2026-07-09)

- **response.md now contains the full raw tool output** — Added `rawContent`
  field to the response protocol so the `.md` attachment carries the complete
  unformatted tool output instead of just the extracted/summarized response.
  This fixes garbled content (Telegram MarkdownV2 escapes in the file) and
  ensures no content is lost. (packages/shared/src/protocol.ts,
  packages/daemon/src/profileRunner.ts, packages/daemon/src/sessionRunner.ts,
  packages/bot/src/main.ts)
- **Fix profileRunner final response truncation** — The profile runner was
  chunking final responses at 4095 chars, causing `completeProcessing` to
  destroy the processing state after the first chunk. Final responses are now
  sent in a single HTTP request, matching the sessionRunner behavior.
  (packages/daemon/src/profileRunner.ts)

## 0.6.2 (2026-07-09)

- **Fix response .md attachment only containing partial content** — When a
  final response exceeded the 4095-char chunk limit, the daemon would send
  multiple HTTP requests to the server, each triggering `completeProcessing`
  which destroyed the processing state after the first chunk. This caused the
  response to be split across multiple Telegram messages and the `.md`
  attachment to contain only the last chunk. Fixed by sending the entire final
  response in a single HTTP request from the daemon (no chunking for final
  responses). (packages/daemon/src/sessionRunner.ts)
- **Replace separate "Message processed" with .md caption** — Removed the
  standalone "✅ Message processed." Telegram message. The full response `.md`
  file now carries "✅ Message processed" as its caption, reducing chat
  clutter. (packages/bot/src/main.ts)

## 0.6.1 (2025-07-13)

- **Attach full response as markdown file** — Changed the full response
  attachment from `response.txt` to `response.md` for better markdown rendering
  when downloaded. The caption remains "full logs".
  (packages/bot/src/main.ts)

## 0.6.0 (2025-07-13)

- **Attach full response as text document with "full logs" caption** — When
  returning responses, the bot now attaches the full response as a text document
  (`response.txt`) with caption "full logs" in addition to editing the processing
  message. This provides users with a downloadable copy of the complete response.
  (packages/bot/src/main.ts)

## 0.5.5 (2025-07-13)

- **Remove RESPONSE_INSTRUCTION entirely** — Deleted the `RESPONSE_INSTRUCTION`
  constant, `wrapWithResponsePolicy` function, and `skipResponseWrapper` option.
  The user's message is now sent to the tool as-is, without any appended format
  instruction. The JSON-retry loop in both runners is also removed; output is
  processed with a simple JSON-then-fallback (`extractLastBlock`) approach.
  (packages/daemon/src/toolExecutor.ts, sessionRunner.ts, profileRunner.ts)

- **Final response now edits the processing message** — Instead of sending the
  final response as new message(s), `sendResponse` in `main.ts` edits the
  existing "🔄 Daemon is processing…" message in-place to show the response
  content. Multi-chunk responses accumulate into the same edit. `sendProcessed`
  still sends "✅ Message processed." as a new message.
  (packages/bot/src/main.ts)

## 0.5.4 (2025-07-12)

- **Fix: concurrent "New Code" tasks no longer break progress/status tracking** —
  Three interrelated bugs fixed in the poll and queue logic:
  - Bug 1: `handleCode` no longer clears `session.latestMessage` to `null` when
    enqueuing a new instruction while another task is running, which previously
    caused "Latest Progress" to show "No progress recorded yet" for up to 5s.
  - Bug 2/3: The poll endpoint no longer claims a new task while one is already
    processing. This prevents `sendProcessing` from overwriting the active task's
    Telegram edit state, and prevents `sendProcessed` from deleting the state
    that a queued task needs for its own progress updates.
  - Bug 4: Tasks submitted while another is running now stay "pending" in the DB
    (`processing_started_at = null`) until the current task completes, so Status
    correctly shows the queued count instead of making them invisible.
  (design.md §4 — Message queue model)

## 0.5.3 (2025-07-12)

- **Docs: reinforce Post-Change Automation in AGENTS.md** — Added prominent
  callout at top of file and explicit instruction to add post-change steps to
  the todo list before starting work, to prevent the agent from skipping them.

## 0.5.2 (2025-07-12)

- **Refactor: rename `SUMMARY_INSTRUCTION` → `RESPONSE_INSTRUCTION`** — Made
  the instruction text explicit that it applies after task completion, not
  during. Renamed `wrapWithSummaryPolicy` → `wrapWithResponsePolicy` and
  `skipSummaryWrapper` → `skipResponseWrapper` throughout.

## 0.5.1 (2025-07-12)

- **Fix: "✅ Message processed." now only sent after all responses** — The
  `sendResponse` method no longer deletes the processing state; instead, only
  `sendProcessed` cleans it up after sending the acknowledgement. This ensures
  "✅ Message processed." is only sent at the very end, after all response
  chunks have been delivered.

## 0.5.0 (2025-07-12)

- **Final responses and \"✅ Message processed.\" sent as new messages** —
  Reverted the editing behavior introduced in 0.4.0: `sendResponse` now sends
  all response chunks as new Telegram messages instead of editing the first
  chunk into the processing message, and `sendProcessed` sends a fresh
  "✅ Message processed." message instead of appending it via edit. Progress
  updates (`sendLatestProgress`) continue to edit the processing message
  in-place. This reduces complexity and ensures the daemon's final response is
  always a distinct message that users can easily find, reply to, or reference.

## 0.4.1 (2025-07-12)

- **Telegram messages now use MarkdownV2 with structured sections** — The
  processing message template separates preview, progress, and response into
  distinct sections. Added `escapeMarkdownV2` helper to safely escape user
  content for Telegram's MarkdownV2 parse mode.

## 0.4.0 (2025-07-12)

- **Telegram messages now edit and append instead of sending new ones** — The
  "🔄 Daemon is processing your message" notification is now edited in-place
  with live progress updates and the first chunk of the AI response when it
  arrives, and "✅ Message processed." is appended to the same message. This
  reduces Telegram message spam from 3+ messages per request down to 1 (+
  overflow chunks for long responses). Falls back gracefully if the original
  message was deleted or cannot be edited.

## 0.3.8 (2025-07-12)

- **Fix: 🆕 New Code no longer hides the in-progress job from 📡 Status** —
  `claimLatestNewCodeAndClearBefore()` in the bot's `MessagesRepo` was deleting
  the in-progress DB row (messages with `processing_started_at IS NOT NULL`).
  This caused the old job to disappear from the Status menu even though the
  daemon was still running it, and led to `completeProcessing()` deleting the
  wrong row. The fix adds `processing_started_at IS NULL` guards to the delete
  conditions, preserving the in-progress row. Only older pending messages are
  now cleared ahead of the new code.

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
