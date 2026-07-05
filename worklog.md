# Worklog

## 2025-07-06

- **v0.2.0 → v0.3.0** — Session creation now clears all sessions for a chatId:
  - `SessionsRepo.create()` deletes ALL existing sessions for the chatId (instead
    of only revoking active ones for the same apiKeyId)
  - Updated tests for the new delete-all behavior
  - Updated design.md §2.2 to document hard-delete on session creation vs soft-delete via admin

- **v0.1.0 → v0.2.0** — Added version/changelog system:
  - Added `APP_VERSION` constant to `@chatcoder/shared`
  - Created `changes.md` at repo root for changelog tracking
  - Updated AGENTS.md: Step 1 now requires version bump and changes.md update
  - Added `📦 v0.2.0` button to Telegram main menu with changelog display
  - Updated design.md §15 with versioning decision documentation
