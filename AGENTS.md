# Repository Guidance

## Coding Principles

All new code **MUST** follow these principles, in order of priority:

1. **Align with existing patterns** — Read the surrounding code and mimic its
   style, structure, naming conventions, and error-handling approach. Don't
   introduce a new pattern when an existing one works, unless the existing
   pattern is demonstrably wrong.

2. **Follow SOLID principles** — Every new class, function, or module should
   respect the five SOLID design principles:
   - **S**ingle Responsibility — each unit has one reason to change.
   - **O**pen/Closed — open for extension, closed for modification.
   - **L**iskov Substitution — subtypes must be substitutable for their base
     types.
   - **I**nterface Segregation — keep interfaces small and focused.
   - **D**ependency Inversion — depend on abstractions, not concretions.

3. **Keep it simple (YAGNI)** — Write the simplest code that solves the
   current, concrete requirement. Do **not** write code for hypothetical
   future needs, abstract extensibility points that have no consumer, or
   generic wrappers that only wrap one thing. Unused code is liability, not
   foresight.

4. **Self-review after writing** — After every change, re-read your own diff
   and remove any unnecessary code: dead variables, unused imports, redundant
   checks, commented-out blocks, or abstractions that aren't pulled by
   anything. Every line should earn its keep.

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
