# Contributing to psg-hub

> **Read this before you touch git.** This repo is worked by multiple agents that
> share a single on-disk checkout. The rules below exist to prevent a realized
> data-loss class (PSG-85): a routine `git stash` once swept up another agent's
> uncommitted work, and concurrent branch-switching in one tree causes the
> divergence risk flagged as the top delivery risk in PSG-56 §5.

## The shared-checkout hazard (why this matters)

The default checkout at `.../psg-hub` is **shared**. At any moment another agent
may have uncommitted work in it. Any command that mutates the shared **HEAD** or
the shared **working tree** can destroy that work:

- `git checkout <branch>` / `git switch <branch>` — moves the shared HEAD out
  from under whoever is mid-task.
- `git stash` / `git stash pop` — silently captures (and can clobber) *every*
  agent's uncommitted changes in the tree, not just yours.
- `git add -A` / `git add .` / `git commit -a` — sweeps unrelated, in-flight
  files from other agents into your commit.
- `git reset --hard`, `git clean -fd` — discard others' work.

## The rules (governance: PSG-87, CEO decision on PSG-85)

**1. Never switch branches or stash in the shared checkout.**
Do **not** run `git checkout <branch>`, `git switch <branch>`, `git stash`,
`git reset --hard`, or `git clean` in `.../psg-hub`. The shared HEAD stays put.

**2. Do all branch work in an isolated worktree.**
For any issue, create a dedicated `git worktree` off `origin/main`. Use the
helper (see below) or `git worktree add` directly. A worktree has its own HEAD,
index, and files, so your branch work cannot touch the shared checkout or anyone
else's uncommitted changes.

**3. Always commit with explicit pathspecs.**
Stage the exact files you changed — `git add path/to/a path/to/b` — **never**
`git add -A`, `git add .`, or `git commit -a`. Even inside a worktree this is
the habit that keeps unrelated changes out of your commits.

**4. One issue → one worktree → one branch → one PR.**
Keying is **per-issue** (not per-agent): it maps cleanly to a single branch and
review unit. Tear the worktree down when the work merges.

**5. Every commit message ends with the co-author trailer:**
`Co-Authored-By: Paperclip <noreply@paperclip.ing>`

## How to do isolated branch work

### With the helper (recommended)

```bash
# from anywhere inside the repo
scripts/psg-worktree.sh create PSG-99            # worktree off origin/main, branch feat/psg-99
cd "$(scripts/psg-worktree.sh path PSG-99)"      # enter it
# ...edit...
git add apps/psg-hub/path/to/file                # EXPLICIT pathspecs only
git commit -m "feat(...): ... [PSG-99]

Co-Authored-By: Paperclip <noreply@paperclip.ing>"
git push -u origin feat/psg-99
scripts/psg-worktree.sh list                     # see all worktrees
scripts/psg-worktree.sh cleanup PSG-99           # after merge (refuses if unpushed/dirty)
```

Flags: `create … --base <ref>` (default `origin/main`), `--branch <name>`
(default `feat/psg-<n>`; an existing local/remote branch of that name is reused),
`cleanup … --force` (discard a dirty/unpushed worktree on purpose).

Worktrees are created in a **sibling** directory of the checkout
(`../psg-worktrees/<ISSUE-ID>` by default, override with `PSG_WT_ROOT`), entirely
outside the tracked tree — there is nothing to accidentally commit.

### Manual equivalent

```bash
git fetch origin
git worktree add ../psg-worktrees/PSG-99 -b feat/psg-99 origin/main
cd ../psg-worktrees/PSG-99
# ...work, commit with explicit pathspecs, push...
git worktree remove ../psg-worktrees/PSG-99   # when done
git worktree prune
```

Both forms leave the shared checkout's HEAD and working tree **completely
untouched** — `git worktree add` and `git fetch` never move the shared HEAD.

## If you find yourself needing to touch the shared HEAD

You almost never do. If something genuinely must run against the shared checkout
(rare), coordinate first on the issue thread so no other agent is mid-task, and
prefer read-only operations. When in doubt: make a worktree.

---

See also: `apps/psg-hub/AGENTS.md` (pinned worktree rule for coding agents) and
the helper at `scripts/psg-worktree.sh`.
