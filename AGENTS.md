# Repository Guidance

## Post-Change Automation

After every change to the repository (code edits, config, documentation, etc.),
**you MUST perform the following steps in order before stopping**:

1. **Update version and changelog** — Assess the change and bump the version
   in **all** files that carry it:

   - `package.json` (root and every workspace: shared, bot, daemon, dashboard)
     (`APP_VERSION` in `@chatcoder/shared` is auto-generated at build time,
      so it no longer needs a manual entry here)

   Version bump convention (semver):
   - **Patch** (0.1.x) — bug fixes, small refactors, dependency bumps, docs
   - **Minor** (0.x.0) — new features, new menu items, new API endpoints
   - **Major** (x.0.0) — breaking changes to protocol, DB schema, or UX flow

   After bumping, add an entry to **`changes.md`** at the repo root with the
   new version, today's date, and a bullet-point summary of what changed and
   why. Keep entries concise; link to design decisions in `design.md` where
   relevant.

2. **Update `design.md`** — Review the change and keep `design.md` as the single
   source of architectural truth. Update any sections (architecture, decisions,
   schema, flow diagrams, configuration tables, etc.) that the change affects.
   Remove stale information that no longer reflects reality. Use the same
   options–trade-offs–choice format for any new decisions added.

3. **Update `README.md`** — Keep the README accurate: update the install
   instructions, CLI help, env-var tables, PM2 commands, or quick-start guide
   if the change affects user-facing behaviour.

4. **Commit and push all changes** — Stage everything (code + changes.md +
   design.md + README.md), write a clear commit message summarising what
   changed and why, commit, and push to the remote.

5. **Restart the service** — Run these two commands:
   ```bash
   npm install -g .
   pm2 restart chatcoder-coder chatcoder-chat
   ```
   This reinstalls the globally linked `chatcoder` CLI (so the `bin` entry
   picks up the latest build output) and restarts both PM2 processes so the
   running services reflect the new code.

> **Note:** If any step fails (e.g. test failure, git conflict, PM2 not
> running), diagnose the failure, attempt to fix it, then retry the step.
