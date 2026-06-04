# gitleaks v0.2 Milestone Secret Scan

**Date:** 2026-06-04
**Plan:** 08-02b (Phase 8 — Launch hardening)
**Tool:** gitleaks 8.30.1 (default ruleset; no custom `.gitleaks.toml`)
**Repo:** `Phoenix-Solutions-Group/psg-internal`, git root `/Users/schoolcraft_mbpro/dev/psg/internal`
**Result:** CLEAN — committed history has zero secrets; every working-tree finding dispositioned (0 unresolved).

No raw secret values appear in this document. All scans ran with `--redact`; findings are recorded by rule + path + line only.

---

## Commands

Run from the git root (so gitleaks' default `-i .` picks up the repo-root `.gitleaksignore`):

```bash
# Authoritative milestone gate — committed history
gitleaks git --redact --no-banner --exit-code 7 \
  --report-format json --report-path /tmp/gitleaks-v0.2-history-final.json

# Supplementary sweep — working tree (gitleaks dir does NOT honor .gitignore)
gitleaks dir --redact --no-banner \
  --report-format json --report-path /tmp/gitleaks-v0.2-worktree.json
```

The **committed-history scan is the milestone gate** ("are there secrets in version control"). The working-tree (`dir`) sweep is supplementary — it scans every file on disk regardless of `.gitignore`, so it surfaces real local credentials that are correctly excluded from VCS.

---

## Result: committed history (the gate)

| Scan | Commits | Findings (pre-allowlist) | Findings (post-allowlist) | Exit |
|------|---------|--------------------------|---------------------------|------|
| `gitleaks git` | 33 | 13 | **0** | **0 (clean)** |

All 13 initial findings were vetted false positives in git-tracked files (below) and added to the repo-root `.gitleaksignore`. Re-run → `no leaks found`, exit 0.

---

## Findings disposition

### Committed / tracked — 13 findings, all FALSE POSITIVES (allowlisted)

| Rule | File | Lines | Verdict |
|------|------|-------|---------|
| curl-auth-header | `apps/psg-import/filemaker/FM_Server_Schedule.md` | 55, 63, 71, 103, 109 | FP — `-H "Authorization: Bearer SESSION_TOKEN"` in FileMaker Data API doc examples; `SESSION_TOKEN` is a runtime placeholder |
| curl-auth-header | `apps/psg-import/filemaker/Recall_Operations_Guide.md` | 28, 62, 74 | FP — same placeholder pattern in API command snippets |
| curl-auth-header | `apps/psg-import/filemaker/FM_Setup_Checklist.md` | 179, 215, 231 | FP — same placeholder pattern |
| generic-api-key | `psg-hub/apps/psg-hub/.paul/references/bsm/STATE.md` | 110 | FP — prose listing service *names* whose creds were TBD ("...ANTHROPIC/YELP/PLACES API keys"); not a credential. Inherited immutable BSM PAUL snapshot. Carried from the v0.1 allowlist (commit + path updated post-absorb) |

All 13 fingerprints recorded in `/Users/schoolcraft_mbpro/dev/psg/internal/.gitleaksignore` with rationale comments.

### Working-tree only — 48 findings, all in VERIFIED-GITIGNORED files (real creds, never committed)

Confirmed via `git check-ignore` that every one of these paths is gitignored and untracked. These are real local credentials / build output, correctly kept out of version control — **not a VCS leak, and intentionally NOT allowlisted** (so that a future *commit* of any `.env` would still flag).

| Rule(s) | File class | Count | Disposition |
|---------|-----------|-------|-------------|
| generic-api-key, jwt, openai-api-key, github-pat | `.next/` build output + turbopack cache | 36 | Build artifacts that echo `NEXT_PUBLIC_*` / env values at build time; gitignored. Not a source of truth |
| jwt, sendgrid-api-token, gcp-api-key, generic-api-key | `.env.local`, `.env`, `.env.production.local`, `.vercel/.env.production.local` | 12 | Real local + Vercel-pulled credentials; gitignored across psg-hub, psg-advantage-portal, psg-data-lake, psg-ads-mutations. Never committed |

### Summary

| Bucket | Count |
|--------|-------|
| Committed FALSE POSITIVES (allowlisted) | 13 |
| Working-tree real creds in gitignored files (verified, not committed) | 48 |
| **Real secrets in version control** | **0** |
| **Unresolved findings** | **0** |

---

## Actions taken

1. Created repo-root `/Users/schoolcraft_mbpro/dev/psg/internal/.gitleaksignore` with the 13 vetted FP fingerprints + rationale.
2. Removed the stale `psg-hub/.gitleaksignore` (pre-absorb commit `956c256e` + old relative path no longer matched after the monorepo absorb rewrote both) — its single bsm/STATE.md entry is folded into the repo-root file with the current commit `f8e53242` and path.
3. Re-ran `gitleaks git` → `no leaks found`, exit 0.

## Deviations from plan

- **Ignore-file location corrected.** Plan grounding said `.gitleaksignore` was at the repo root; it was actually one level down at `psg-hub/.gitleaksignore` with a stale post-absorb fingerprint, so the git-root scan didn't honor it. Fixed by creating the authoritative repo-root file and removing the stale subdir copy. (Plan listed `../../.gitleaksignore` = `psg-hub/.gitleaksignore`; actual correct path is the git root.)
- No `.gitleaks.toml` was added. The committed-history scan is clean without it; the `dir`-mode build-artifact noise is documented rather than path-allowlisted, to avoid creating a blind spot that would also hide a future *committed* `.env`.

## Notes / carry-forward

- A pre-commit / CI gitleaks gate was explicitly out of scope for 08-02b (no CI wiring). Recommend wiring `gitleaks git` into CI or a pre-commit hook before broad customer launch (v0.4) so the milestone gate runs automatically.
- gitleaks `dir` mode ignores `.gitignore`; if a recurring local sweep is wanted, scope it to tracked files or add a `.gitleaks.toml` path allowlist for `.next/`, `.vercel/`, `node_modules/`, `archive/` (build/dep/vendor only — never `.env`).
