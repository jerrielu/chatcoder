# chatcoder

Telegram-driven remote codex control — drive AI coding sessions on a remote
machine from Telegram.

See [design.md](./design.md) for architecture and [worklog.md](./worklog.md)
for the build history.

---

## Install

Requires Node 20+ and npm. The release is distributed as a self-contained npm
tarball that bundles the compiled `dist` artifacts and ships all runtime
dependencies (including the private `@chatcoder/shared` package), so a global
install needs no build step and no access to the monorepo workspaces.

```bash
# 1. Clone and build the release tarball (builds dist, then packs it)
git clone https://github.com/jerrielu/chatcoder.git
cd chatcoder
npm run pack:release          # -> /tmp/chatcoder-<version>.tgz

# 2. Install the tarball globally
npm install -g /tmp/chatcoder-0.12.4.tgz
```

> **Why the tarball, not `npm install -g .`?** `npm install -g .` performs a
> *linked* install that symlinks the package back to your source checkout and
> installs **none** of its workspace runtime dependencies — the resulting CLI
> cannot resolve `fastify`, `grammy`, `better-sqlite3`, `@chatcoder/shared`,
> etc. The `pack:release` flow produces a real, self-contained tarball that
> installs correctly. (Installing straight from `github:jerrielu/chatcoder`
> is also broken — npm 10.x/11.x pacote extracts empty directories for git
> deps — so use the tarball.)

Or from source:

```bash
git clone <this repo> && cd chatcoder
nvm use
npm install
npm run build
```

> **Native build toolchain:** `better-sqlite3` compiles a native addon during
> install, so the global install needs `make` + a C/C++ compiler
> (`build-essential` on Debian/Ubuntu, or Xcode CLT on macOS). The optional
> voice-transcription path (`whisper-node`) additionally compiles C++ on first
> use.
> ```bash
> sudo apt-get install -y build-essential ffmpeg
> ```
>
> **Voice transcription** (optional): to use voice messages, install `ffmpeg`:
> ```bash
> sudo apt-get install ffmpeg
> ```
> The first time a voice message is received, whisper.cpp will be compiled and
> the multilingual `base` model (~142 MB) will be downloaded automatically
> via the `whisper-node` npm dependency.

---

## npm run dev Commands

| Command | What it does |
|---------|-------------|
| `npm start` | Build release artifacts and run **both** the bot chat service and the coder daemon (`coder --daemon`) |
| `npm run pm2:start` | Build and run **both** services under PM2 (`chatcoder-chat`, `chatcoder-coder`) |
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
# One command: build and run both the bot (chat) and the coder daemon
export TELEGRAM_BOT_TOKEN=123456:ABC-xxxxxxxx
npm start

# Or run them separately:
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

### Daemon configuration

The daemon reads `~/.chatcoder/config.yml` (created by the setup wizard).
Notable options (full list in [design.md](./design.md#9-configuration)):

| Key               | Default           | Purpose                                                        |
|-------------------|-------------------|----------------------------------------------------------------|
| `stallTimeoutMs`  | `900000` (15 min) | Kill a tool process that emits no output for this long and relaunch the same task under the same session (`0` disables) |
| `stallRetries`    | `3`               | How many times a stalled task is killed and relaunched before it fails with an error (`0` = fail on the first stall) |
| `pollIntervalMs`  | `2000`            | How often the daemon polls the bot API for new instructions    |
| `heartbeatIntervalMs` | `15000`       | How often the daemon reports liveness                          |
| `idleShutdownMs`  | `3600000` (1 h)   | Shut down the daemon after this long with no work              |
| `maxConcurrency`  | `4`               | Max tool processes running at once                             |

> **Reasonix permission mode:** all reasonix runs (bot sessions and TUI
> launches) are forced to auto permission mode (`--permission-mode auto`,
> appended after any profile `extraArgs`), so they auto-approve ordinary
> writer fallbacks while still asking for genuinely risky operations. This
> cannot be overridden per profile. See [design.md §7.5](./design.md).

**Stale-process recovery (automatic):** the daemon keeps a single-instance
registry at `~/.chatcoder/daemon-state.json`. On startup it kills any daemon
from a previous run and its leftover tool processes, then claims sole
ownership; on shutdown it kills its own tool children. The bot additionally
re-checks every 60 s: any in-progress task whose daemon stopped heartbeating
(`BOT_HEARTBEAT_STALE_MS`, default 60 s) is killed and re-queued so it reruns
when a daemon reconnects — you get a Telegram notice when that happens. Restarts
(PM2/systemd) now forward SIGINT/SIGTERM to the whole process tree, so orphaned
processes and frozen progress messages can no longer accumulate.

> If you see a `better_sqlite3` native module error after switching Node
> versions, run `npm rebuild better-sqlite3`.

---

## PM2 (Production)

Run both services under PM2 for automatic restarts and logging:

```bash
cd <chatcoder repo>
npm run pm2:start          # builds and runs BOTH chat and coder under PM2
```

Or start them manually:

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

---

## Telegram Menu

The bot presents an inline keyboard with these actions:

| Button | Behaviour |
|--------|-----------|
| 💻 Code | Resume the last CLI session with a new instruction |
| 🆕 New Code | Start a fresh CLI run with a new instruction |
| 🔬 New Code + Review | Queues your instruction first, then separately queues a deep code review that also fixes all found issues |
| 👤 Profile | Switch the active AI tool profile |
| 📁 Folder | Pick a working directory |
| 📋 Latest Progress | Show the latest daemon progress output |
| ⏹ Stop | Request the daemon to stop the current task |
| 🆕 New Session | Create a new session (revokes the current one) |
| 📡 Status | Show daemon heartbeat and queue status |
| 📦 vX.Y.Z | Show version and changelog |

