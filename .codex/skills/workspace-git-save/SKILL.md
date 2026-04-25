---
name: workspace-git-save
description: Workspace git workflow for pulling latest changes and saving work. Use in this workspace when the user asks to pull latest git changes, update from remote, save changes, commit and push, or save to a named branch. By default, save work to the dev branch unless the user mentions another branch.
---

# Workspace Git Save

## Branch Selection

- Use the branch named by the user when provided.
- Otherwise use `dev`.
- If `dev` is missing and the user did not name a branch, inspect local and remote branches and prefer `dev`, then `develop`, then the current branch. Tell the user when using a fallback.

## Pull Latest

When the user asks to pull latest git changes:

1. Inspect repository state with `git status --short --branch`.
2. Determine the target branch using the branch selection rules.
3. If local changes exist, protect them before pulling. Use `git stash push -u` with a clear message only when the changes are clearly safe to stash; otherwise ask the user.
4. Run `git fetch --all --prune`.
5. Check out the target branch, creating it from `origin/<branch>` when needed.
6. Run `git pull --ff-only`.
7. If fast-forward pull fails, stop and report the divergence or conflicts. Do not merge or rebase without explicit user approval.
8. If changes were stashed, reapply with `git stash pop` and resolve only obvious conflicts that are within the requested work.

## Save Changes

When the user says "save changes", "commit and push", or equivalent:

1. Inspect state with `git status --short --branch`.
2. Determine the target branch using the branch selection rules.
3. Run `git fetch --all --prune`.
4. Check out the target branch. Create it from `origin/<branch>` if the remote branch exists but no local branch exists. Create a new branch from the current HEAD only when the user clearly requested a new branch or no remote target exists.
5. Integrate remote changes with `git pull --ff-only`. Stop if the branch has diverged.
6. Review intended changes with `git diff --stat`, `git diff`, and `git diff --cached`.
7. Stage only intended files by explicit path. Use `git add .` only when the user clearly wants every changed file included and the worktree is understood.
8. Commit with the user's message when provided. Otherwise write a concise imperative commit message that describes the actual change.
9. Push to `origin <branch>`. If no upstream exists, use `git push -u origin <branch>`.
10. Report the branch, commit hash, and push result.

## Guardrails

- Never run destructive commands such as `git reset --hard`, `git clean`, forced push, or branch deletion unless the user explicitly asks for that exact operation.
- Do not rewrite history with rebase or amend unless explicitly requested.
- Do not commit secrets, generated junk, or unrelated user changes.
- If unrelated changes are present, leave them unstaged and mention them.
- If tests are relevant and practical, run them before committing; otherwise say why they were skipped.
