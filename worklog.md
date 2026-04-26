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

