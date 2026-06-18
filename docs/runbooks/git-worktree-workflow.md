# Runbook: Git worktree workflow (shared-checkout safety)

*Owner: Engineering (Ada). Source: [PSG-85] risk → [PSG-87] implementation. Status: standard.*

## TL;DR — the two rules

Multiple agents operate in **one shared working tree** (`.../psg-hub`) at the same time. That makes
two ordinary git operations dangerous:

1. **Never `git checkout <branch>` / `git switch` in the shared checkout.** It moves HEAD under every
   other agent mid-run. (Observed: the shared tree hopped `feat/60 → feat/28 → feat/26a` in one hour,
   and a branch ref got reset to an unrelated commit.)
2. **Never `git stash` in the shared checkout.** Stash is global to the working tree — it sweeps up
   *other agents'* uncommitted files, and a stray shared stash can be `pop`ped by the wrong agent.
   (Observed in [PSG-85]: a routine stash swept up another agent's `ops-access.ts`, live-CSI
   `registry.ts`, and `ROADMAP.md`.)

**Do branch work in your own isolated `git worktree` instead** — created off `origin/main`, committed,
pushed, then torn down. A worktree has its own HEAD, index, and files; it cannot touch the shared
checkout or anyone else's work. Use the helper:

```bash
scripts/psg-worktree.sh create PSG-123      # isolated worktree off origin/main
cd "$(scripts/psg-worktree.sh path PSG-123)"
# ...edit, then commit with EXPLICIT pathspecs (never `git add -A`/`git add .`)...
git add path/to/changed/file
git commit -m "feat(...): ... [PSG-123]"
git push -u origin feat/psg-123
# after merge:
scripts/psg-worktree.sh cleanup PSG-123
```

## Third rule (applies everywhere, including worktrees)

3. **Always commit with explicit pathspecs.** `git add -A` / `git add .` / `git commit -a` can capture
   files that belong to another workstream. Stage the exact files you changed:
   `git add apps/psg-hub/src/...`. This matters most if you must touch the shared checkout at all.

## Why worktrees (and why per-issue)

- A `git worktree` is a second checkout backed by the *same* `.git`. Branch switches, commits, and
  stashes inside it are invisible to the shared tree — eliminating the whole collision class.
- We key worktrees **per issue** (`one issue → one worktree → one branch → one PR`) because that maps
  cleanly to the review/merge unit. Per-agent also works; per-issue is preferred.
- Worktrees live in a **sibling** directory of the checkout (`../psg-worktrees/<ISSUE>`), entirely
  outside the tracked tree, so there is nothing to accidentally commit.

## `scripts/psg-worktree.sh` reference

| Command | What it does |
|---|---|
| `create <issue> [--base <ref>] [--branch <name>] [--print-cd]` | Fetches origin (no effect on shared HEAD), creates `../psg-worktrees/<ISSUE>` on a new branch off `origin/main` (default). Reuses an existing local/remote branch if one matches. `--print-cd` emits a `cd` line for `eval`. |
| `path <issue>` | Prints the worktree path (use with `cd "$(...)"`). |
| `list` | `git worktree list`. |
| `cleanup <issue> [--force]` | Removes the worktree. **Refuses** if there are uncommitted changes or unpushed commits unless `--force`. |

Notes:
- Issue ids are normalized: `87`, `psg-87`, `PSG-87` all resolve to `PSG-87`; default branch is
  `feat/psg-87`.
- New branches are created `--no-track`, so a bare `git push` cannot accidentally target `main` —
  set upstream intentionally with `git push -u origin <branch>`.
- Override the worktree root with `PSG_WT_ROOT` if needed (default `../psg-worktrees`).
- The script resolves the shared checkout via `git-common-dir`, so it works from *any* worktree.

## If you ever find a stray shared stash

Don't blind-`drop`/`pop` it. Verify each file in it is already preserved (committed on `origin/main`
or present on a pushed branch) with `git diff <stash> origin/main -- <file>`, export it as a recoverable
patch (`git stash show -p <stash> > /tmp/recovered.patch`) for the record, **then** drop it.

---

*Tracking: PSG-85 (risk surfaced) → PSG-87 (this workflow + `scripts/psg-worktree.sh`).*
