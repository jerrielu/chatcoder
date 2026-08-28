# chatcoder

Telegram-driven remote codex control — drive AI coding sessions on a remote
machine from Telegram.

See [design.md](./design.md) for architecture and [worklog.md](./worklog.md)
for the build history.

---

## Install

Requires Node 20+ and npm.

### Global install (`npm install -g .`)

`npm install -g .` is a **linked install**: npm symlinks the package to your
source checkout and installs **none** of its dependencies into the global
location. For the global `chatcoder` CLI to find its runtime dependencies
(`fastify`, `grammy`, `better-sqlite3`, the private `@chatcoder/shared`
workspace package, etc.), those must already be linked into the **repo's own
`node_modules`**. So the reliable sequence is two steps, run **at the repo
root**:

```bash
git clone https://github.com/jerrielu/chatcoder.git
cd chatcoder

# 1. Install workspace deps + link @chatcoder/shared locally (run at repo root)
npm install

# 2. Link the CLI globally (resolves deps from the repo's node_modules above)
npm install -g .
```

> **Why step 1 is required:** without it there is no `node_modules`, and the
> globally linked CLI cannot resolve `@chatcoder/shared` (or any other dep).
> The private `@chatcoder/shared` package is **never** published to npm, so it
> must be linked from the local workspace.

> **`npm install -g github:jerrielu/chatcoder` is not supported** — npm
> 10.x/11.x pacote extracts empty directories for git deps. Clone + the two
> steps above instead.

### Troubleshooting: `404 Not Found - GET https://registry.npmjs.org/@chatcoder%2fshared`

This means npm gave up on the local workspace link and tried to fetch the
private `@chatcoder/shared` from the public registry (where it does not
exist). It is **not** a packaging bug — it is stale lockfile/state. Fix:

```bash
# From the repo root, discard stale state and regenerate a clean lockfile
rm -rf node_modules package-lock.json
npm install          # links @chatcoder/shared to ./packages/shared
```

This happens if `package-lock.json` predates a version bump (the
`@chatcoder/shared` reference must match the local workspace `version`), or
was left over from a different branch/state. **Do not** run `npm install`
from inside `packages/*` — workspaces only resolve from the repo root.

### Development only (run from source)

```bash
git clone <this repo> && cd chatcoder
nvm use
npm install
npm run build
```

> **Voice transcription** (optional): to use voice messages, install `ffmpeg`
> and the `whisper-node` npm dependency (its bundled whisper.cpp is compiled via
> cmake on install):
> ```bash
> sudo apt-get install ffmpeg cmake build-essential
> npm install whisper-node
> ```
> The multilingual `base` model (~142 MB) is downloaded automatically on first use.
> If `whisper-node` is not installed, the bot keeps working normally — text
> commands and menus are unaffected — but a voice message returns a notice that
> transcription is unavailable and asks the user to type their instruction.
>

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

> **Command Code profiles:** profiles with tool kind `COMMAND_CODE` run the
> `cmd` CLI headless and always non-interactively
> (`cmd -p --yolo -c --model <id> [--effort <level>] "<instruction>"`) —
> `--yolo` (permission bypass) is forced and cannot be disabled. Each
> Command Code profile is created manually in the setup wizard: you type
> the model id (consult `cmd --list-models` to find it) and pick an effort
> preset. The daemon does not auto-discover or auto-generate Command Code
> profiles. The Telegram effort picker applies to these profiles too. See
> [design.md §7.6](./design.md).

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

