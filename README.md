# chatcoder

Telegram-driven remote codex control — drive AI coding sessions on a remote
machine from Telegram.

See [design.md](./design.md) for architecture and [worklog.md](./worklog.md)
for the build history.

---

## Install

Requires Node 20+ and npm.

```bash
# From local source (most reliable)
git clone https://github.com/jerrielu/chatcoder.git
cd chatcoder
npm install -g .

# Or from the packed tarball
npm pack --pack-destination /tmp
npm install -g /tmp/chatcoder-0.1.0.tgz
```

> **Note:** `npm install -g github:jerrielu/chatcoder` does not work due to
> a bug in npm's git dependency handling (npm 10.x/11.x pacote extracts
> empty directories). Install from local source or tarball instead.

Or from source:

```bash
git clone <this repo> && cd chatcoder
nvm use
npm install
npm run build
```

---

## npm run dev Commands

| Command | What it does |
|---------|-------------|
| `npm run dev:coder` | TUI interactive menu |
| `npm run dev:coder -- --daemon` | Daemon mode (connects to bot) |
| `npm run dev:chat` | Bot HTTP API service (port 8080) |
| `npm run dev:dashboard` | Web admin panel (port 8090) |
| `npm test` | Run all tests |
| `npm run lint` | Lint all packages |
| `npm run build` | Build all packages |

---

## chatcoder CLI

```
usage: chatcoder <chat|coder> [options]

commands:
  chat          Bot HTTP API service (port 8080)
  coder         Coder service (default: TUI menu)

coder sub-commands:
  (no args)     TUI interactive menu
  --daemon      Daemon mode (connect to bot, poll queue)
  --path        Print config file path

options:
  --systemd     Install and start a per-user systemd service
  -h, --help    Show this help
```

---

## Quick Start

```bash
# Terminal 1: start the bot
export TELEGRAM_BOT_TOKEN=123456:ABC-xxxxxxxx
chatcoder chat

# Terminal 2: run the daemon
chatcoder coder --daemon

# Or use the TUI locally (no bot needed)
chatcoder coder
```

Environment variables for the bot:

| Env var              | Default                 | Purpose                |
|----------------------|-------------------------|------------------------|
| `TELEGRAM_BOT_TOKEN` | (required)              | BotFather token        |
| `DATABASE_URL`       | `sqlite:~/.chatcoder/chatcoder.db` | Database connection    |
| `BOT_LISTEN_HOST`    | `0.0.0.0`               | API bind host          |
| `BOT_LISTEN_PORT`    | `8080`                  | API bind port          |

> If you see a `better_sqlite3` native module error after switching Node
> versions, run `npm rebuild better-sqlite3`.

---

## PM2 (Production)

Run both services under PM2 for automatic restarts and logging:

```bash
npm install -g pm2
pm2 start "$(which chatcoder)" --name chatcoder-chat -- chat
pm2 start "$(which chatcoder)" --name chatcoder-coder -- coder --daemon
pm2 save
pm2 startup   # persist across reboots
```

Useful commands:

```bash
pm2 logs chatcoder-coder          # tail daemon logs
pm2 restart chatcoder-coder       # restart daemon
pm2 stop chatcoder-coder          # stop daemon
pm2 delete chatcoder-coder        # remove from PM2
pm2 delete chatcoder-chat chatcoder-coder  # remove all chatcoder processes
```

