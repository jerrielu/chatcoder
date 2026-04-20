# chatcoder

Telegram-driven remote codex control.

See [design.md](./design.md) for architecture, [guide.md](./guide.md) for
how to run it, and [worklog.md](./worklog.md) for the build history.

```bash
nvm use           # Node 24.15.0 via .nvmrc
npm install
npm run build
npm test
npm run lint
```

If you switch to a different Node major after install, run
`npm rebuild better-sqlite3` to recompile the native addon.

To run the local admin dashboard (no auth, binds to 127.0.0.1:8090):

```bash
npm run dev:dashboard
# then open http://127.0.0.1:8090/sessions
```
