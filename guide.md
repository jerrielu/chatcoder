# Chatcoder — User Guide

Chatcoder lets you drive a `codex` interactive session on a remote machine
from Telegram: type `/code write a regression test for foo`, your server
executes it, and the response comes back as a Telegram message.

## Parts
- **Telegram bot** — the control plane. Long-polls Telegram and exposes an API.
- **Admin dashboard** — local web UI to manage sessions and queues.
- **chatcoder coder** — runs on your remote machine; polls the bot and drives codex.

---

## 1. Quick Start (Local Setup)

Requirements: Node 24 (`nvm use`).

```bash
git clone <this repo> && cd chatcoder
nvm use
npm install
npm run build
```

### 1.0 Install from GitHub as a CLI

You can install directly from GitHub and use the top-level `chatcoder` command:

```bash
npm install -g github:jerrielu/chatcoder
chatcoder --help
```

### 1.1 Run the Bot
```bash
export TELEGRAM_BOT_TOKEN=123456:ABC-xxxxxxxx
chatcoder chat
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
# Runs daemon mode directly.
chatcoder coder
# Optional setup/config commands:
chatcoder coder --setup
chatcoder coder config-path
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
- **📡 Status**: Check daemon heartbeat and queued instruction count.

**Instructions:** Use the `/code` prefix: `/code explain this file`.
**Responses:** Your daemon's replies arrive as regular Telegram messages in
the same chat — no button to tap. While a task is running, progress snapshots
are stored for status/dashboard views; only final responses are sent to the
chat. After the bot clears an in-progress queue item, it sends a short
processed acknowledgement.

Normal Code messages continue the current tool session and run FIFO. New Code
starts fresh: it preempts active work for that session, clears older queued or
in-progress work, and leaves newer queued work behind it. When a daemon
restarts, its first poll asks the bot for any in-progress work and resumes it
with a `continue` instruction if no newer New Code request supersedes it.

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
- **Messages**: View/edit/delete the queued instructions waiting for the daemon.
- **Real-time**: Sessions list polls every 15s, detail page every 10s.

The bot's admin API at `/v1/admin/*` accepts only loopback callers (both the
request peer IP and, for browser requests, the `Origin` header's hostname
must be loopback — any port). Non-loopback peers get a silent 404. Ordinary
daemon traffic at `/v1/heartbeat`, `/v1/poll`, `/v1/responses`, `/v1/session`
is unchanged (bearer-authed).

---

## 5. Coder Setup

Run on the remote machine where `codex` is installed.

```bash
npm run dev:coder
```
Answer the prompts:
- **API URL**: The public URL of your bot.
- **API Key**: The `cc_...` key from Telegram.
- **Profiles/Tool config**: choose and configure at least one profile.

Config is saved to `~/.chatcoder/config.yml` (0600).

### 5.1 Run with PM2

Run both processes under PM2 (use the absolute path to the globally installed binary so PM2 can find it):

```bash
npm install -g pm2
pm2 start "$(which chatcoder)" --name chatcoder-chat -- chat
pm2 start "$(which chatcoder)" --name chatcoder-coder -- coder run
pm2 status
```

Useful commands:

```bash
pm2 logs chatcoder-chat
pm2 logs chatcoder-coder
pm2 restart chatcoder-chat
pm2 restart chatcoder-coder
pm2 stop chatcoder-chat
pm2 stop chatcoder-coder
```

Persist across reboots:

```bash
pm2 save
pm2 startup
```

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `NODE_MODULE_VERSION` mismatch | `npm rebuild better-sqlite3` |
| `401 UNAUTHORIZED` | Re-run **New Session** in Telegram, then `chatcoder coder --setup`. |
| `node-pty` build fails | `apt install build-essential python3` |
| Daemon offline | Check `BOT_HEARTBEAT_STALE_MS` (default 60s). |
