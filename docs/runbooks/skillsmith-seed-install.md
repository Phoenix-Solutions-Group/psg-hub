# Runbook — Skillsmith + Seed Pinned Local Install (Track C / C1)

**Issue:** PSG-344 (C1) · **Parent:** PSG-328 (Track C) · **Owner:** CTO Ada
**Gate:** CEO/security sign-off recorded (approval `85663806-b4cc-42b8-8551-3eb5554b4cbf`).
**Scope:** The two cleared frameworks **only** — Skillsmith and Seed. PAUL is contained, Aegis declined.
**Status:** Validated in sandbox (node v24.16.0 / npm 11.13.0) on 2026-06-23. This is the authorized install method for C2.

> **Guardrails (non-negotiable, from the approved Track C plan §2):**
> - **Local / per-project only. No global install. No `curl | bash`.**
> - Pinned **exact** versions, integrity-verified from the public npm registry.
> - These tools author skills/specs/plans that are *converted into* Paperclip issues. **Paperclip remains the single system of record.**

---

## 1. Pinned versions + provenance (verified)

| Package | Pinned version | License | Maintainer | Source repo | Published |
|---|---|---|---|---|---|
| `@chrisai/skillsmith` | **1.0.0** | MIT | `christopherkahler` (Chris Kahler) | `github.com/ChristopherKahler/skillsmith` | 2026-06-03 |
| `@chrisai/seed` | **1.0.0** | MIT | `christopherkahler` (Chris Kahler) | `github.com/ChristopherKahler/seed` | 2026-06-03 |

**Integrity (verify these — they are pinned in `package-lock.json` and re-checked on every `npm ci`):**

```
@chrisai/skillsmith@1.0.0
  tarball   : https://registry.npmjs.org/@chrisai/skillsmith/-/skillsmith-1.0.0.tgz
  sha1      : 39ce47bb6f8184f88c8c261625353e7247b56805
  integrity : sha512-k3wTg9wTMQ3CUENy7iO2qMnlWMo/YwCEkQmL1qsAUksBAOAE6qPvc25S0/2na90qjZZoEi8PzW/JaGp0j8zk9Q==

@chrisai/seed@1.0.0
  tarball   : https://registry.npmjs.org/@chrisai/seed/-/seed-1.0.0.tgz
  sha1      : 1da8b5e25dc88e9de0d297d2e19e71ef8b3b05a8
  integrity : sha512-aPV61yg3UOQ1j9O+cwPMm+y0DbmYGzWrL04mFBj57oxUa7vmh1gobidsfxxq+9zISp1c+XCpqh9WP00mw6hbXA==
```

**Supply-chain facts (verified from each tarball manifest):**
- **No runtime dependencies** in either package (zero transitive surface).
- **No `preinstall`/`postinstall`/lifecycle scripts** → `npm install` runs *no code*; the only executable is the `bin` (`bin/install.js`), which runs *only* when you explicitly invoke it in Step B.
- `npm audit` → **0 vulnerabilities** for both.
- Bus factor = 1 (single maintainer). Pinning the exact version (this runbook) is the control for that risk.

---

## 2. ⚠️ Two things that will bite you (read before running)

1. **The packages' installer defaults to GLOBAL.** Running `npx @chrisai/skillsmith` with no flag writes to `~/.claude/` (your home Claude config). **That violates the Track C guardrail.** You MUST pass **`--local`** so it writes to the project's `./.claude/` instead. (Confirmed from `--help`: *"`-l, --local` — Install to `./.claude/commands/` instead of global"*.)
2. **This environment sets `NODE_ENV=production` and npm `omit=dev`.** A plain `npm install --save-dev …` will record the dep in `package-lock.json` but **silently skip extracting it** into `node_modules` ("audited 1 package"). Always pass **`--include=dev`** (commands below already do).

---

## 3. Install procedure (pinned, local, no global, no curl|bash)

Run from the project root (the repo/workspace you want the skills in).

### Step A — Vendor the pinned packages locally (integrity-checked, no code runs)

```bash
npm install --save-dev --save-exact --include=dev \
  @chrisai/skillsmith@1.0.0 \
  @chrisai/seed@1.0.0
```

- `--save-exact` writes `"1.0.0"` (not `"^1.0.0"`) to `package.json`.
- `--include=dev` defeats the `omit=dev` gotcha in §2.
- npm verifies the `sha512` integrity in §1 against `package-lock.json`; a mismatch aborts the install.
- **Reproducible/CI form:** once `package-lock.json` is committed, use `npm ci` (fails closed on any integrity or lockfile drift).

### Step B — Scaffold the skills into the **project** `.claude/` (NOT global)

```bash
# Skillsmith → ./.claude/commands/skillsmith + ./.claude/skillsmith-specs
node node_modules/@chrisai/skillsmith/bin/install.js --local

# Seed → ./.claude/commands/seed (+ data/templates/checklists)
node node_modules/@chrisai/seed/bin/install.js --local
```

Use `node node_modules/.../bin/install.js --local` (deterministic, runs the *pinned, already-vendored* copy). Do **not** use bare `npx @chrisai/...` — it defaults to global and, without `--no-install`, may re-resolve from the network.

### Step C — Verify it landed locally and global is untouched

```bash
ls ./.claude/commands/skillsmith ./.claude/commands/seed   # exist
ls "$HOME/.claude/commands/skillsmith" 2>&1                # must NOT exist
```

Then open Claude Code and run `/skillsmith` or `/seed`.

---

## 4. Dry-run / sandbox validation evidence (2026-06-23)

Executed in throwaway sandboxes under `/tmp` with an isolated npm cache. `$HOME/.claude` was confirmed untouched throughout.

**Checksum verification** — downloaded both tarballs and recomputed digests; they match §1 exactly:
```
@chrisai/skillsmith@1.0.0  sha1 39ce47bb…56805  sha512-k3wTg9wTMQ3…zk9Q==   ✅ match
@chrisai/seed@1.0.0        sha1 1da8b5e2…b05a8  sha512-aPV61yg3UOQ…hbXA==   ✅ match
```

**Install (Step A) with `--include=dev`:**
```
added 2 packages, and audited 3 packages in 584ms
found 0 vulnerabilities
node_modules/@chrisai → seed  skillsmith
```
(Without `--include=dev`: "up to date, audited 1 package" and nothing extracted — the documented `omit=dev` gotcha.)

**Local scaffold (Step B):**
```
Skillsmith → Installing to ./.claude/   (entry point + 5 tasks + 6 rules + templates + 7 specs)
Seed       → Installing to ./.claude/commands/seed   (entry + 5 tasks + 15 data files + 5 templates + checklist)
```
`find ./.claude` showed `./.claude/commands/{skillsmith,seed}`; `$HOME/.claude/commands/{skillsmith,seed}` did **not** exist → **no global pollution**. ✅

**Reversibility spot-check (informs C5):**
```
rm -rf ./.claude/commands/skillsmith ./.claude/skillsmith-specs ./.claude/commands/seed
npm uninstall @chrisai/skillsmith @chrisai/seed
→ node_modules/@chrisai empty; grep -c "@chrisai" package-lock.json → 0   (clean revert)
```

---

## 5. Acceptance criteria (C1) — status

- [x] Exact pinned versions + commands recorded (this runbook, §1 & §3).
- [x] Dry-run executed in sandbox; output captured (§4).
- [x] No global install, no `curl|bash`; checksum/source verified (§1, §3 Step B `--local`, §4).
- [x] Runbook linked back on PSG-328 as the validated install method (see PSG-344 / PSG-328 thread).

---

## 6. Handoff

- **C2 (PSG-349 — rollout):** use §3 verbatim on the agreed scope; verify §3 Step C (no `~/.claude` pollution) per host.
- **C5 (PSG-350 — rollback):** build on §4 reversibility spot-check (uninstall + delete scaffolded `./.claude/commands/{skillsmith,seed}` + `./.claude/skillsmith-specs`).
- Re-pin only by bumping the exact version here **and** refreshing the §1 integrity hashes from a fresh tarball download.
