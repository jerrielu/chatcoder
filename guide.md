# chatcoder — Commands Reference

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

## Install from GitHub

```bash
npm install -g github:jerrielu/chatcoder
chatcoder --help
```

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

