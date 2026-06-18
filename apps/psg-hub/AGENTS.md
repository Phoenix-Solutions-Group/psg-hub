<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:psg-worktree-isolation -->
# ⚠️ Shared checkout — use git worktrees, never branch-switch or stash here

This repo is worked by **multiple agents in one shared on-disk checkout**. Branch-switching
or stashing in it is a realized data-loss hazard (PSG-85). Hard rules (full detail in the
repo-root `CONTRIBUTING.md`):

- **Never** `git checkout <branch>` / `git switch` / `git stash` / `git reset --hard` /
  `git clean` in the shared checkout. The shared HEAD stays put.
- **Do all branch work in an isolated worktree** (one per issue), off `origin/main`:
  - `scripts/psg-worktree.sh create PSG-<n>` → `cd "$(scripts/psg-worktree.sh path PSG-<n>)"`
  - …or `git worktree add ../psg-worktrees/PSG-<n> -b feat/psg-<n> origin/main`
  - tear down with `scripts/psg-worktree.sh cleanup PSG-<n>` after merge.
- **Always stage explicit pathspecs** — `git add path/to/file`, never `git add -A` / `git add .` / `git commit -a`.
- Every commit message ends with: `Co-Authored-By: Paperclip <noreply@paperclip.ing>`
<!-- END:psg-worktree-isolation -->
