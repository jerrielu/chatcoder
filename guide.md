# Chatcoder — User Guide

Chatcoder lets you drive a `codex` interactive session on a remote machine
from Telegram: type `/code write a regression test for foo`, your server
executes it, and the response comes back as a Telegram message.

## Parts
- **Telegram bot** — the control plane. Long-polls Telegram and exposes an API.
- **Admin dashboard** — local web UI to manage sessions and queues.
- **chatcoder-daemon** — runs on your remote machine; polls the bot and drives codex.

---

## 1. Quick Start (Local Setup)

Requirements: Node 24 (`nvm use`).

```bash
git clone <this repo> && cd chatcoder
nvm use
npm install
npm run build
```

### 1.1 Run the Bot
```bash
export TELEGRAM_BOT_TOKEN=123456:ABC-xxxxxxxx
npm run dev:bot
```
Default: `0.0.0.0:8080`, `sqlite:./chatcoder.db`.

### 1.2 Run the Dashboard
```bash
npm run dev:dashboard
```
Runs Vite on `http://127.0.0.1:5173`. The dashboard is a pure static frontend
(React + Vite) — it has no server-side code. It calls the bot's admin API at
`VITE_BOT_API_URL` (default `http://127.0.0.1:8080`). The bot must be running
on the same host (admin routes are loopback-only).

For a production build:
```bash
npm run build -w @chatcoder/dashboard
# Serve the resulting packages/dashboard/dist/ with any static server, e.g.:
npx serve packages/dashboard/dist -p 5173
```

### 1.3 Run the Daemon
```bash
# First time setup:
npm run dev:daemon -- setup
# Then run:
npm run dev:daemon -- run
```



> **CRITICAL: Native Module Errors**
> If you see `Error: The module ... better_sqlite3.node was compiled against a different Node.js version`, it means your current Node version doesn't match the one used during `npm install`.
> **Fix:** Run `npm rebuild better-sqlite3` in the project root.

---

## 2. Bot Configuration

| Env var                  | Default                   | Purpose                                          |
|--------------------------|---------------------------|--------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`     | (required)                | BotFather token                                  |
| `DATABASE_URL`           | `sqlite:./chatcoder.db`   | `sqlite:path.db` or `postgres://…`              |
| `BOT_LISTEN_HOST`        | `0.0.0.0`                 | API bind host                                   |
| `BOT_LISTEN_PORT`        | `8080`                    | API bind port                                   |
| `BOT_PUBLIC_URL`         | (auto)                    | URL shown in key hand-off                        |
| `BOT_LOG_LEVEL`          | `info`                    | pino level                                       |

---

## 3. Telegram Flow

Open your bot in Telegram → `/start`:

- **🆕 New Session**: Revokes current, creates new. Copy the API key immediately!
- **📡 Status**: Check daemon heartbeat and queue depths.
- **📨 Response**: Pull the oldest pending response from the daemon.

**Instructions:** Use the `/code` prefix: `/code explain this file`.

---

## 4. Admin Dashboard

Pure static SPA (React + Vite). No server, no database access of its own — it
fetches everything from the bot's admin API. By default it runs on Vite's dev
server at `127.0.0.1:5173`, but you can point any static host at the built
output (`packages/dashboard/dist/`). Build-time env vars:

| Env var            | Default                 | Purpose                                         |
|--------------------|-------------------------|-------------------------------------------------|
| `VITE_BOT_API_URL` | `http://127.0.0.1:8080` | Where the bot's admin API lives                 |

- **Sessions**: List, filter, rotate keys, revoke, or delete.
- **Messages**: View/edit/delete queued instructions and responses.
- **Real-time**: Sessions list polls every 15s, detail page every 10s.

The bot's admin API at `/v1/admin/*` accepts only loopback callers (both the
request peer IP and, for browser requests, the `Origin` header's hostname
must be loopback — any port). Non-loopback peers get a silent 404. Ordinary
daemon traffic at `/v1/heartbeat`, `/v1/poll`, `/v1/responses`, `/v1/session`
is unchanged (bearer-authed).

---

## 5. Daemon Setup

Run on the remote machine where `codex` is installed.

```bash
npm run dev:daemon -- setup
```
Answer the prompts:
- **API URL**: The public URL of your bot.
- **API Key**: The `cc_...` key from Telegram.
- **Codex Command**: usually `codex`.

Config is saved to `~/.chatcoder-daemon/config.yml` (0600).

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `NODE_MODULE_VERSION` mismatch | `npm rebuild better-sqlite3` |
| `401 UNAUTHORIZED` | Re-run **New Session** in Telegram, then `daemon setup`. |
| `node-pty` build fails | `apt install build-essential python3` |
| Daemon offline | Check `BOT_HEARTBEAT_STALE_MS` (default 60s). |
