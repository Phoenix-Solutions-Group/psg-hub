# Runbook — Skillsmith + Seed Rollback / Clean Removal (Track C / C5)

**Issue:** PSG-350 (C5) · **Parent:** PSG-328 (Track C) · **Owner:** CTO Ada
**Pairs with:** [Install runbook](./skillsmith-seed-install.md) (C1 / PSG-344) — this doc reverses it.
**Scope:** The two cleared frameworks **only** — `@chrisai/skillsmith` and `@chrisai/seed`. PAUL is contained, Aegis declined.
**Status:** Verified clean revert in sandbox (node v24.16.0 / npm 11.13.0) on 2026-06-23. Authorized rollback method for C2.

> **Reversibility guarantee:** the C1 install is *additive and local* — two pinned npm devDependencies plus a fixed set of scaffolded files under the project `./.claude/`. There are **no lifecycle scripts**, no global writes (install used `--local`), and **no runtime deps**. So rollback is a bounded, deterministic delete + `npm uninstall`. Nothing outside the project tree is touched.

---

## 1. One-command rollback (recommended)

From the project root:

```bash
scripts/skillsmith-seed-uninstall.sh
```

The script is **idempotent**, **scoped**, and **self-verifying**. It:

1. Removes only the three scaffold directories the installers create (§3).
2. Runs `npm uninstall @chrisai/skillsmith @chrisai/seed`.
3. Verifies the revert and exits non-zero if any residue remains.

Flags:

- `--dry-run` — print every action without changing anything (review first).
- `--root <path>` — target a project root other than the current git toplevel.

```bash
scripts/skillsmith-seed-uninstall.sh --dry-run          # preview
scripts/skillsmith-seed-uninstall.sh --root /path/to/repo
```

**Exit codes:** `0` clean revert verified · `1` usage/precondition error · `2` residue remained (manual inspection needed).

> ### ⚠️ Safety contract (why this is not `rm -rf .claude`)
> `./.claude/` is a **shared** directory — it also holds PSG's own `CLAUDE.md`, `skills/`, and other commands. The script removes **only** the Skillsmith/Seed scaffold paths in §3 and never the whole `.claude/`. Pre-existing content is preserved (proven in §4).

---

## 2. Exact artifact surface this rollback reverses

The C1 install (`docs/runbooks/skillsmith-seed-install.md` §3) produces exactly:

| Artifact | Created by | Removed by rollback |
|---|---|---|
| `package.json` devDeps `@chrisai/skillsmith@1.0.0`, `@chrisai/seed@1.0.0` | Step A (`npm install`) | `npm uninstall` (Step 2) |
| `package-lock.json` `@chrisai/*` entries | Step A | `npm uninstall` (Step 2) |
| `node_modules/@chrisai/{skillsmith,seed}` | Step A | `npm uninstall` (Step 2) |
| `./.claude/commands/skillsmith/` (entry, rules, tasks, templates) | Step B `--local` | `rm -rf` (Step 1) |
| `./.claude/commands/seed/` (entry, tasks, data, templates, checklists) | Step B `--local` | `rm -rf` (Step 1) |
| `./.claude/skillsmith-specs/` (7 spec files) | Step B `--local` | `rm -rf` (Step 1) |

This is a **closed set** — the installers write nothing else (verified by full filesystem snapshot diff in §4).

---

## 3. Manual rollback (equivalent, if you can't run the script)

Run from the project root. This is exactly what the script does.

```bash
# Step 1 — remove scaffolded skill files (scoped; never the whole .claude/)
rm -rf ./.claude/commands/skillsmith \
       ./.claude/commands/seed \
       ./.claude/skillsmith-specs

# Step 2 — remove the pinned npm devDependencies
npm uninstall @chrisai/skillsmith @chrisai/seed
```

### Verify the revert

```bash
# scaffold gone
ls ./.claude/commands/skillsmith ./.claude/commands/seed ./.claude/skillsmith-specs 2>&1   # all: No such file

# package metadata clean
grep -c '@chrisai/' package.json package-lock.json     # both → 0
ls node_modules/@chrisai 2>&1                          # No such file or directory

# pre-existing .claude content still present (sanity)
ls ./.claude                                           # CLAUDE.md, skills/, your own commands still here
```

In a git repo, the rollback should reduce to a reviewable diff:

```bash
git status --porcelain ./.claude package.json package-lock.json
# expect: deleted scaffold files + the two removed @chrisai lock/manifest entries, nothing else
```

> **npm note:** `npm uninstall` regenerates `package-lock.json`. In this committed repo the lockfile already exists, so `git diff package-lock.json` shows **only** the removal of the two `@chrisai/*` blocks. In a from-scratch sandbox npm leaves an empty `node_modules/` and a fresh lockfile — both with **zero** `@chrisai` references (see §4).

---

## 4. Sandbox verification evidence (2026-06-23)

Performed in a throwaway sandbox under `/tmp` with an isolated npm cache. To prove the rollback is non-destructive, the sandbox project was **pre-seeded** with realistic pre-existing `.claude/` content (`CLAUDE.md`, `skills/existing.md`, `commands/existing-cmd.md`) — mirroring the real psg-hub `.claude/`.

**Method:** snapshot tree → install (C1 §3) → run `scripts/skillsmith-seed-uninstall.sh` → snapshot tree → `diff`.

**Result — filesystem diff (post-rollback vs pre-install) was identical** except for npm's own `node_modules/` + regenerated `package-lock.json` (both `@chrisai`-free):

```
-- Step 3: verify clean revert --
  OK: .claude/ preserved (pre-existing content intact)
✅ Clean revert verified: Skillsmith + Seed fully removed; pre-rollout state restored.
```

**Pre-existing content preserved (byte-for-byte):**
```
preserved: .claude/CLAUDE.md            -> '# real CLAUDE.md - must survive'
preserved: .claude/skills/existing.md   -> 'real-skill'
preserved: .claude/commands/existing-cmd.md -> 'real-command'
```

**Residue checks (all clean):**
```
.claude/commands/skillsmith  → absent
.claude/commands/seed        → absent
.claude/skillsmith-specs     → absent
node_modules/@chrisai        → absent
grep -c @chrisai package.json package-lock.json → 0 / 0
```

**Idempotency:** re-running the script on the already-clean tree exits `0` and makes no further changes.

**Dry-run:** `--dry-run` printed all planned actions and changed nothing.

---

## 5. Acceptance criteria (C5) — status

- [x] One-command / scripted uninstall + removal steps for Skillsmith + Seed (`scripts/skillsmith-seed-uninstall.sh`, §1; manual equivalent §3).
- [x] Verified clean revert to pre-rollout state in sandbox (§4 — full-tree diff identical, residue checks clean, pre-existing `.claude/` preserved).
- [ ] Rollback doc linked on PSG-328 before C2 install is considered complete → **done in the PSG-350 / PSG-328 thread on commit of this doc.**

---

## 6. Handoff / operational notes

- **C2 (PSG-349 — rollout):** rollback is now in place; C2 install may proceed. If any host needs to back out, run §1 there.
- **Partial rollback** (one framework only): delete just that framework's scaffold dir(s) and `npm uninstall` only that package. For Skillsmith that is **both** `./.claude/commands/skillsmith` *and* `./.claude/skillsmith-specs`; for Seed it is `./.claude/commands/seed`.
- **Global-install accident:** if someone ran the installer **without** `--local` (violating the C1 guardrail), it wrote to `~/.claude/commands/{skillsmith,seed}` instead. This project script does not touch `$HOME`; remove those manually: `rm -rf "$HOME/.claude/commands/skillsmith" "$HOME/.claude/commands/seed" "$HOME/.claude/skillsmith-specs"`.
- **System of record:** Skillsmith/Seed only *author* skills/specs that are converted into Paperclip issues. Removing them does not affect Paperclip, which remains authoritative.
