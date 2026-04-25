# 2026-04-25

- Added root guidance files for Codex and Claude Code instructing agents to update `worklog.md` for every repository change, grouped by date.
- Added daemon/bot support for claiming one queued instruction at a time, tracking in-progress work, resuming in-progress Codex runs after daemon restart, and completing work only after final responses post.
- Added Codex token-usage request handling, concise final-response prompting, progress-update formatting, and a shared dev runner for bot/daemon rebuild-and-restart loops.
- Updated related API, database, daemon, bot, and test coverage for the queue processing and response behavior changes; `npm run lint` and `npm run typecheck` pass. `npm test` passes all test cases but exits nonzero because current global coverage is below thresholds.
