# chatcoder

Telegram-driven remote codex control — drive AI coding sessions on a remote
machine from Telegram. See [design.md](./design.md) for architecture.

## Prerequisites

- Node 20+ (`.nvmrc` pins 24.15.0)
- npm
- Optional for voice transcription: `ffmpeg` and `whisper-node`

## Setup

```bash
git clone https://github.com/jerrielu/chatcoder.git
cd chatcoder
npm install
npm run build          # required for dev:* commands (uses compiled dist)
```

`npm run pm2:start` and `npm run local` run the build automatically.

## Configuration

Bot (environment variables):

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | yes | — | BotFather token |
| `DATABASE_URL` | no | `sqlite:~/.chatcoder/chatcoder.db` | Database connection |
| `BOT_LISTEN_HOST` | no | `0.0.0.0` | API bind host |
| `BOT_LISTEN_PORT` | no | `8080` | API bind port |

Daemon (`~/.chatcoder/config.yml`, created by the setup wizard):

| Key | Default | Purpose |
|-----|---------|---------|
| `apiUrl` | — | Bot API URL |
| `apiKey` | — | Session API key |
| `cwd` | — | Working directory |
| `pollIntervalMs` | `2000` | Poll interval |
| `stallTimeoutMs` | `3600000` | Kill/restart tool after no output |
| `maxConcurrency` | `1` | Max concurrent tool processes |

Example `~/.chatcoder/config.yml` for running Command Code (`cmd`):

```yaml
apiUrl: http://localhost:8080
apiKey: cc_xxxxxxxx
cwd: /path/to/your/project
pollIntervalMs: 2000
maxConcurrency: 1
profiles:
  - name: cmd
    tool: COMMAND_CODE
    config:
      model: <model-id from `cmd --list-models`>
```

## Run (dev)

```bash
npm run dev:chat              # bot HTTP API (port 8080)
npm run dev:coder -- --daemon # daemon mode (reads ~/.chatcoder/config.yml)
npm run dev:dashboard         # web admin (port 8090)
npm test                      # run tests
npm run build                 # build all packages
npm run local                 # build + restart PM2 processes
```

## Run (production, PM2)

```bash
npm run pm2:start   # build + run both chat and coder under PM2
```

Manual:

```bash
pm2 start bin/chatcoder.js --name chatcoder-chat -- chat
pm2 start bin/chatcoder.js --name chatcoder-coder -- coder --daemon
pm2 save
```

## Telegram menu

| Button | Behaviour |
|--------|-----------|
| 💻 Code | Resume last session with new instruction |
| 🆕 New Code | Fresh CLI run |
| 🔬 New Code + Review | Queue instruction, then deep code review |
| 👤 Profile | Switch AI tool profile |
| 📁 Folder | Pick working directory |
| 📋 Latest Progress | Show latest daemon output |
| ⏹ Stop | Stop current task |
| 🆕 New Session | Create new session |
| 📡 Status | Daemon heartbeat and queue status |
| 📦 vX.Y.Z | Version and changelog |

Typing `resume` / `continue` / `cont` / `res` while idle behaves like 💻 Code.

## Notes

- Command Code (`cmd`) profiles are added via the setup wizard. See
  [design.md](./design.md) §7.6.