---
phase: 08-launch-hardening
plan: 02b
type: execute
wave: 1
depends_on: []
files_modified:
  - .paul/phases/08-launch-hardening/SCAN-gitleaks-v0.2.md
  - .paul/phases/08-launch-hardening/CHECKLIST-idempotency.md
  - ../../.gitleaksignore
  - .paul/STATE.md
autonomous: true
---

<objective>
## Goal
Run the v0.2 milestone gitleaks scan and consolidate the idempotency mechanism + pre-merge checklist (S4) — both light, no DB migration, no app-behavior change. Two near-zero-risk hardening chores split out of 08-02 so the high-blast-radius RLS migration stayed single-concern.

## Purpose
Two of the v0.2 readiness gates from the trajectory audit (ROADMAP "v0.2 Readiness Gates"):
- **gitleaks scan per milestone — no real secrets** (compliance constraint; v0.1 was clean with 1 vetted FP allowlisted). v0.2 added RBAC/RLS migrations, onboarding, tier, shop-switcher, and 14 prod env keys wired to Vercel — re-scan before a real shop logs in.
- **S4 — idempotency mechanism + pre-merge checklist** consolidated as new tables/imports land. Phase 3 proved the pattern across two webhooks; Phase 6 added `llm_call_log`; onboarding (07-01) writes a client→shop→member ladder. Capture the one canonical pattern + a reusable pre-merge checklist so every future webhook/import inherits it, mirroring how 06-01 captured S1 (`PROTOCOL-migration-safety.md` + `CHECKLIST-rls-review.md`).

## Output
- `SCAN-gitleaks-v0.2.md` — scan command, scope, findings table (rule · file:line · verdict), FP rationale, any `.gitleaksignore` additions, clean/blocked result.
- Updated `.gitleaksignore` (repo root) only if a NEW vetted false positive surfaces.
- `CHECKLIST-idempotency.md` — the canonical idempotency mechanism + a pre-merge checklist for new webhooks/imports, with the known Stripe INSERT-not-UPSERT gap named as a v0.4 carry.
</objective>

<context>
## Project Context
@.paul/PROJECT.md
@.paul/ROADMAP.md
@.paul/STATE.md

## S1 precedent for the doc shape (mirror its structure for S4)
@.paul/phases/06-rbac-rls-spine/CHECKLIST-rls-review.md
@.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md

## Established idempotency implementations (source the canonical pattern FROM these)
@src/app/api/webhooks/sendgrid/route.ts
@src/app/api/webhooks/twilio/route.ts

## Grounding captured at plan time (2026-06-04)
- **gitleaks** 8.30.1 on PATH (`/opt/homebrew/bin/gitleaks`). No custom `.gitleaks.toml` → default ruleset. `.gitleaksignore` lives at the REPO ROOT `/Users/schoolcraft_mbpro/dev/psg/internal/.gitleaksignore` (592 B, holds the 1 vetted v0.1 FP). Git root = `/Users/schoolcraft_mbpro/dev/psg/internal` (repo `Phoenix-Solutions-Group/psg-internal`); gitleaks runs from there.
- **Idempotency pattern (already shipped, Phase 3):** signature-verify → service-role `upsert(rows, { onConflict: <key>, ignoreDuplicates: true })` against a DB `UNIQUE` constraint. SendGrid key = `sg_event_id`; Twilio key = composite `UNIQUE(message_sid, status)`. Migration-side UNIQUE is the idempotency anchor (matches the 06-04 `UNIQUE(review_item_id)` and `llm_call_log` work).
- **Known gap (do NOT fix here):** the Stripe webhook is the inherited S3 defect — INSERT not UPSERT — tracked to the v0.4 billing path. The checklist NAMES it as a carry; this plan does not touch billing.
- This is a docs + scan plan: expected `src/**` change = none; test count stays 229.
</context>

<acceptance_criteria>

## AC-1: gitleaks v0.2 milestone scan is clean (or blocked on a real secret)
```gherkin
Given the psg-internal repo at its current HEAD plus the working tree
When gitleaks scans both committed history and uncommitted files using the repo-root .gitleaksignore
Then every reported finding is classified as either a real secret (escalated + remediated, loop blocked) or a vetted false positive (allowlisted in .gitleaksignore with a recorded rationale)
And the final scan exits with zero unresolved findings
```

## AC-2: idempotency mechanism + pre-merge checklist consolidated
```gherkin
Given the idempotency pattern already shipped across the SendGrid and Twilio webhooks
When CHECKLIST-idempotency.md is authored
Then it documents the one canonical mechanism (signature-verify → DB UNIQUE → upsert ignoreDuplicates), gives a reusable pre-merge checklist for any new webhook or import, references the live examples by path, and names the Stripe INSERT-not-UPSERT gap as a v0.4 carry
```

## AC-3: no DB migration, no app-behavior change, gates green
```gherkin
Given this plan is scan + docs only
When it completes
Then no migration file is created, no src/** behavior changes, and pnpm typecheck / pnpm test (229) / pnpm build remain green
```

</acceptance_criteria>

<tasks>

<task type="auto">
  <name>Task 1: Run the v0.2 milestone gitleaks scan, vet findings, allowlist FPs</name>
  <files>.paul/phases/08-launch-hardening/SCAN-gitleaks-v0.2.md, ../../.gitleaksignore</files>
  <action>
    Run from the git root `/Users/schoolcraft_mbpro/dev/psg/internal` (where `.gitleaksignore` lives), default ruleset, structured output:
    - History scan: `gitleaks git --report-format json --report-path /tmp/gitleaks-v0.2-history.json` (scans committed history; honors the repo-root `.gitleaksignore`).
    - Working-tree scan (catches uncommitted/staged, incl. this branch's unsaved work): `gitleaks dir --report-format json --report-path /tmp/gitleaks-v0.2-worktree.json`.
    Use the gitleaks 8.30.x subcommands (`git` / `dir`); confirm with `gitleaks version` and `gitleaks --help` first if a flag is rejected (do NOT guess deprecated `detect`/`--source` syntax — read the help).

    For EACH finding: classify as real secret vs false positive.
    - Real secret → STOP, escalate to the operator with the rule + file:line (REDACTED value), and remediate (rotate + remove) before the loop can close. This is the only path that blocks AC-1.
    - False positive (placeholder, test fixture, public key, env-var NAME not value, example) → add its fingerprint to the repo-root `.gitleaksignore` with a one-line rationale comment, matching the existing v0.1 FP entry style.
    Re-run the scan after allowlisting until it exits with zero unresolved findings.

    Write `SCAN-gitleaks-v0.2.md`: the exact commands, scan scope (history + worktree), a findings table (rule · file:line · verdict · action), the rationale for each FP, the `.gitleaksignore` lines added (if any), and the final clean result. NEVER paste a full secret value into the doc — record rule name + redacted fingerprint only.
  </action>
  <verify>Final `gitleaks git` and `gitleaks dir` runs exit 0 (no leaks) with the repo-root `.gitleaksignore` applied; SCAN-gitleaks-v0.2.md exists with the commands, findings table, and clean result; any new FP is in `.gitleaksignore` with a rationale.</verify>
  <done>AC-1 satisfied: milestone scan clean, every finding vetted (real → remediated/blocked; FP → allowlisted with rationale).</done>
</task>

<task type="auto">
  <name>Task 2: Author CHECKLIST-idempotency.md (S4 consolidation) + run gates</name>
  <files>.paul/phases/08-launch-hardening/CHECKLIST-idempotency.md</files>
  <action>
    Read the SendGrid + Twilio webhook routes first (cited in context) so the doc reflects the SHIPPED code, not a guess. Author `CHECKLIST-idempotency.md` mirroring the structure of the 06-01 `CHECKLIST-rls-review.md`:
    - **Canonical mechanism:** signature/auth verify FIRST → derive a stable idempotency key → DB `UNIQUE` constraint on that key (migration-side, the real anchor) → service-role `upsert(rows, { onConflict: <key>, ignoreDuplicates: true })` → ack 2xx so the provider stops retrying. Note the at-least-once delivery assumption that makes this necessary.
    - **Live examples (by path):** SendGrid `sg_event_id` (single-column UNIQUE); Twilio composite `UNIQUE(message_sid, status)` (one row per status transition); the 06-04 `UNIQUE(review_item_id)` and 06-05 `llm_call_log` as DB-side precedents.
    - **Pre-merge checklist** (the reusable gate for any NEW webhook or import): key is stable + provider-supplied; UNIQUE exists in a migration (not just app-level dedup); write path is upsert/ignoreDuplicates not bare INSERT; signature/auth verified before any DB write; replay test exists (same payload twice → 1 row); ack semantics correct.
    - **Known gaps / carries:** Stripe webhook is INSERT-not-UPSERT (inherited S3 defect) → fix in the v0.4 billing path; onboarding (07-01) writes a multi-step ladder with compensating cleanup rather than upsert (note its idempotency story).
    Then run the gates to prove no regression: `pnpm typecheck`, `pnpm test`, `pnpm build`.
  </action>
  <verify>CHECKLIST-idempotency.md exists with the four sections (mechanism · examples · pre-merge checklist · carries) and cites the real webhook paths; `pnpm typecheck` clean · `pnpm test` 229 green · `pnpm build` ✓; `git status` shows zero `src/**` changes.</verify>
  <done>AC-2 + AC-3 satisfied: S4 idempotency mechanism + pre-merge checklist consolidated; no migration, no src behavior change, gates green.</done>
</task>

</tasks>

<boundaries>

## DO NOT CHANGE
- Any `src/**` app code — this is scan + docs only. No webhook/route edits.
- The Stripe webhook / billing path — the INSERT-not-UPSERT defect (S3) is documented here, FIXED in v0.4.
- `supabase/migrations/**` — no DB migration in this plan (08-02 closed the RLS work).
- RLS policies, 06-02 RBAC, 06-03 gate, 07-03 shop context — untouched.

## SCOPE LIMITS
- gitleaks milestone scan + S4 doc consolidation ONLY.
- First AEGIS pass = 08-03. Quality gates (Vitest ≥70% + Playwright + WCAG) = 08-04.
- NO new dependency (gitleaks already installed; no CI wiring in this plan).
- Secret handling: never paste a full secret value into any tracked file; redacted fingerprint + rule name only. Never disable a gitleaks rule wholesale to silence a finding — allowlist the specific fingerprint with a rationale.
- A REAL secret finding is a blocking escalation (remediate + rotate), not an FP to allowlist.

</boundaries>

<verification>
Before declaring plan complete:
- [ ] `gitleaks git` + `gitleaks dir` final runs exit 0 with the repo-root `.gitleaksignore` applied
- [ ] SCAN-gitleaks-v0.2.md records commands, scope, findings table, FP rationale, clean result (no raw secrets)
- [ ] Any new FP added to `.gitleaksignore` with a one-line rationale
- [ ] CHECKLIST-idempotency.md has mechanism + live examples + pre-merge checklist + carries, citing real paths
- [ ] `pnpm typecheck` / `pnpm test` (229) / `pnpm build` green
- [ ] `git status` shows zero `src/**` changes; no migration file created
- [ ] All acceptance criteria met
</verification>

<success_criteria>
- v0.2 milestone gitleaks scan is clean; every finding vetted (real secrets escalated/remediated; FPs allowlisted with rationale).
- S4 idempotency mechanism + pre-merge checklist consolidated into a reusable doc that mirrors the 06-01 S1 artifacts and reflects the shipped code.
- Zero DB migration, zero app-behavior change, gates green.
</success_criteria>

<output>
After completion, create `.paul/phases/08-launch-hardening/08-02b-SUMMARY.md`.
</output>
