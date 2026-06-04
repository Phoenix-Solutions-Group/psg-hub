# Enterprise Trajectory Audit — psg-hub (whole-project plan)

**Target:** the entire psg-hub plan (`PROJECT.md` + `ROADMAP.md` + `MILESTONES.md` + live `STATE.md`), not a single phase PLAN.md
**Audited:** 2026-06-02
**Auditor role:** senior principal engineer + compliance reviewer
**Question asked:** "audit this entire plan to make sure we are still on the same path for success"
**Verdict:** v0.1 as executed = **solid**. Forward roadmap as a path to the North Star (MRR) = **conditionally acceptable** — two structural concerns (revenue sequencing, compliance sequencing) plus operational debt that must close before the first customer dollar (v0.4).

---

## Workflow note (read this — not a skipped step)

`/paul:audit` is built to harden a *pending* PLAN.md that is about to execute, and to auto-apply must-have fixes into it. **There is no pending plan here**: v0.1 is closed, the loop is IDLE, and v0.2 is not yet planned. Silently rewriting committed, operator-authored milestone records (`ROADMAP.md` / `PROJECT.md` / v0.1 phase + decision history) would be overwriting work, not remediation. So auto-apply is degraded to its only faithful form:

- **Primary deliverable = this AUDIT.md.**
- **Additive apply = one marked `v0.2 Readiness Gates` block** appended to ROADMAP's *Next Milestone* section, expressing the must-have findings as entry criteria for v0.2 planning.
- **Findings, not actions** for the deploy / merge / push items — those are operator-gated prod actions, surfaced below, not taken.
- **No v0.1 record is rewritten.**

---

## 1. Executive Verdict

**Would I sign my name to v0.1 as a foundation? Yes.** It is unusually well-documented, the integration work is real (signature-verified, idempotent, live-verified webhooks), and the audit trail in STATE.md is genuinely defensible.

**Would I approve the forward roadmap as a path to MRR success without raising my hand? No — conditionally.** One structural fact dominates the "same path for success" question:

> **Success is defined as MRR. Of the 10 forward milestones, only three (v0.2 → v0.4) touch revenue at all. The other seven (v1.1 → v2.0) are internal ops, ads tooling, production mail, reports, superadmin, agentic intelligence, and hardening — none of which a customer pays for.** The first dollar cannot be collected until v0.4 (Invoicing + Payments = "v1.0 customer launch"), which sits behind two full sequential milestones, under an explicit *single team, strictly sequential* constraint (D62) and an explicit *no fixed launch date, quality-first* posture (D60).

That is not a defect — D60/D62 are deliberate operator choices. It **is** the single biggest risk to a North Star that carries an EOY-2026 horizon. The plan does not contain a deadline-anchored revenue checkpoint that reconciles "ship when ready" with "MRR by end of year." If EOY 2026 is a real target rather than a measurement horizon, that reconciliation is the most important missing piece in the whole plan.

The second structural concern: **compliance and security controls are sequenced behind customer launch.** PII encryption (pgsodium), the PII RLS review, and AEGIS are all written into the constraints but scheduled at or after v0.4 / v2.0 — i.e., *after* real customer and payment data is flowing on a shared production database. That is the classic audit-failure shape: features first, controls last.

Everything else below is supporting detail or operational debt.

## 2. What Is Solid (do not change)

- **Resilience + idempotency as a shared primitive.** `src/lib/resilience.ts` (retry + circuit breaker) reused verbatim across two providers, with webhooks made idempotent by DB UNIQUE constraints and signature-verified (ECDSA SendGrid / HMAC Twilio). This is correctly layered and is the right reusable foundation. Keep it; make later integrations conform to it (see S4).
- **Security-first relocation.** Phase 1 secured the BSM IDOR during the move and kept secrets out of git (only `.example` tracked; gitleaks clean across 75 commits). Correct instinct.
- **Single source of brand truth.** Collapsing BSM oklch + ads-dashboard token-overrides + portal DESIGN-SYSTEM.md into one `packages/ui/psg-brand/` submodule with a documented "submodule wins on divergence" rule removes a real long-term drift hazard.
- **The audit trail itself.** STATE.md + the inheritance INDEX make planned-vs-actual reconstructable and decisions traceable. This is the strongest single asset in the project for surviving a real audit, and it is rare. Do not let it decay.
- **Honest reframes.** Phases 4 and 5 were caught as already-satisfied and closed lean instead of manufacturing busywork. Good discipline.

## 3. Enterprise Gaps / Latent Risks

1. **No revenue checkpoint between the plan and the North Star.** (Spine — §1.) The roadmap optimizes for completeness of the converged platform, not for time-to-first-MRR. There is no milestone, gate, or success metric that says "first paying shop by date X."
2. **Compliance controls are back-loaded behind v0.4.** PII encryption, PII RLS review, AEGIS scoped to v2.0 (now recommended v0.2). Customer + payment data lands at v0.4; the controls that defend it are scheduled later or last.
3. **Production deploys only from one laptop.** Vercel cannot build the private `design-system` submodule, so prod is shipped by manual CLI `vercel --prod` with a locally-initialized submodule. No CI build, no reproducible artifact, no rollback story, no second operator. This is a release-engineering single point of failure that becomes unacceptable the moment money moves (v0.4).
4. **"Complete" is not on `main` and not on `origin`.** v0.1 is marked complete, yet Phase 4 (`3e76691`), Phase 5 (`964fd17`), the milestone-close commit (`3a641d9`), and tag `v0.1.0` are local/branch-only and unpushed. The completed milestone is recoverable only from one machine. Bus factor = 1; a disk failure loses "complete."
5. **One shared Supabase project, no environment isolation.** `gylkkzmcmbdftxieyabw` backs hub + portal + BSM + the archived projects. A bad migration or an RLS mistake has whole-estate blast radius, and there is no staging/prod separation implied anywhere. The plan's *own* PII + RLS constraints imply this hygiene is required before customer data scales.
6. **Known inherited defects are buried in a caveat, not the forward backlog.** From the BSM inheritance: Stripe webhook uses INSERT not UPSERT (duplicate subscription rows on re-subscribe) — this lands directly in v0.4 billing; refresh-token-compromise window unmitigated; no review-sync cron. These are flagged in `references/INDEX.md` but appear in no v0.3/v0.4 plan.
7. **Idempotency is a constraint enforced only by convention.** It holds for the two current webhooks. Stripe (v0.4), RO/Estimate import (v1.1), and ads mutations (v1.2) each reintroduce the risk with no shared enforcement mechanism or pre-merge checklist.
8. **Quality gates are all unstarted under a quality-first mandate.** Vitest ≥70%, Playwright E2E, WCAG AA, LCP < 2s, and brand-conformance are every one "Not started." D60 makes quality the explicit business constraint, but nothing enforces it yet.
9. **Pilot cohort revenue validation is unscheduled.** Wallace + Tedesco + Tracy's are named (D61) with a "0 of 3 onboarded" metric, but no milestone owns getting them live and paying. The thing that proves MRR is real has no home in the plan.
10. **Open legal exposure: Gotham font.** Gotham is Adobe Typekit-licensed and is shipped to production as self-hosted `.otf` files in the submodule. STATE flags it; it is unresolved.

## 4. Concrete Upgrades Required

### Must-Have (close before the first customer dollar at v0.4; some are immediate)

| # | Finding | What must change |
|---|---------|------------------|
| M1 | No revenue checkpoint vs MRR North Star | Decide explicitly whether EOY-2026 MRR is a hard target or a horizon. If hard: add a deadline-anchored revenue checkpoint and treat v0.2→v0.4 + pilot onboarding as the critical path; defer scope that does not serve it. Make the D60/D62-vs-deadline tradeoff a recorded, conscious decision, not an implicit one. |
| M2 | Compliance controls back-loaded behind launch | Pull a PII + RLS + secret-handling security gate forward to **v0.2** (first new customer code) and a focused **PII RLS review before any shop sees live data** — not v2.0. AEGIS first pass at v0.2 (already recommended in PROJECT). |
| M3 | Prod deploy is laptop-CLI-only | Before v0.4, commit to a reproducible deploy: option A (GitHub Actions prebuilt → `vercel deploy --prebuilt --prod`) or option B (vendor brand assets into the repo). Remove the single-operator dependency. |
| M4 | "Complete" milestone is unpushed / not on main | Push `chore/phase-3-integrations` (Phases 4/5 + close commit) and tag `v0.1.0` to origin now. Resolve the submodule gate or accept option C explicitly, then land v0.1 on `main`. Recoverability should not depend on one disk. |

### Strongly Recommended

| # | Finding | What must change |
|---|---------|------------------|
| S1 | Shared Supabase blast radius | Establish staging/prod isolation (or, at minimum, a documented, enforced migration-safety + RLS-review protocol) before v0.2 customer tables land. |
| S2 | Pilot onboarding unscheduled | Give the Wallace/Tedesco/Tracy's pilot an owning slice (a v0.4 onboarding track or a dedicated v0.x) so first MRR is a planned deliverable with an activation checklist. |
| S3 | Inherited defects not in forward plan | Add to the v0.3/v0.4 backlog as explicit fix items: Stripe INSERT→UPSERT, refresh-token-compromise mitigation, review-sync cron. Do not let them stay caveats. |
| S4 | Idempotency by convention only | Promote idempotency to a shared mechanism + a pre-merge checklist item that every webhook/import must satisfy. |
| S5 | Quality gates unstarted | Activate the Vitest ≥70% + Playwright happy-path gate at v0.2; add WCAG AA + brand-conformance at the first customer UI; LCP budget on `/dashboard` at v0.3. |
| S6 | Gotham licensing | Resolve the Typekit license posture (proper license, or swap to a licensed/owned face) before broad customer launch at v0.4. |

### Can Safely Defer

| # | Finding | Why safe to defer |
|---|---------|-------------------|
| C1 | Phase 4/5 front-loading "smell" | LOW. Future milestones are explicitly "plans TBD at kickoff" — they will be planned with current knowledge when reached, so phantom-phase risk is lower, not higher. Planning-hygiene reminder only. |
| C2 | Decision registry partly external (70 decisions in `projects/psg-hub/PLANNING.md` v7, outside `.paul`) | Auditability is fine via STATE/PROJECT today. Consolidate opportunistically. |
| C3 | 01-02 out-of-repo archival (CFO/governance/obsidian-vault relocate-or-leave) | Records already corrected; no product impact. |
| C4 | `.base/*` commit-tracking convention drift | Harmless tooling state; operator already chose to leave as-is. |

## 5. Audit & Compliance Readiness

- **Defensible evidence: strong.** STATE.md, per-plan APPLY logs, the decision table, and the inheritance INDEX would let an auditor reconstruct what happened and why. This is the project's best compliance asset.
- **Silent-failure prevention: partial.** Webhooks fail-closed and persist-to-retry (good). But there is no review-sync cron, no enforced idempotency mechanism beyond convention, and no monitoring/alerting described anywhere — silent failure of a cron or a missed webhook would not surface.
- **Post-incident reconstruction: good at the planning layer, untested at the runtime layer.** No runtime audit log, no error tracking, no staging to reproduce against are described for the customer surfaces that are about to be built.
- **Ownership/accountability: clear for decisions, thin for operations.** Decisions name an owner; operational responsibilities (who can deploy, who reviews PII access, who owns the pilot's activation) are not assigned. M3/M4/S2 are partly ownership gaps.
- **Would it fail a real audit today?** As an internal foundation with zero live customers (D57): no. **The moment a customer with PII logs in (v0.2) or pays (v0.4), the back-loaded PII/AEGIS/staging posture (M2, S1) would fail a SOC-2/privacy review.** That is why M2 and S1 are sequenced to v0.2, not v2.0.

## 6. Final Release Bar

**What must be true before this plan is "on the path to success":**

1. A conscious decision on EOY-2026 MRR as target-vs-horizon, with a revenue checkpoint if it is a target (M1).
2. PII/security/RLS gate pulled forward to v0.2 and a PII RLS review before any shop sees live data (M2).
3. A reproducible, non-laptop deploy path committed before v0.4 (M3).
4. v0.1 pushed to origin and landed on `main` (M4) — recoverability off one machine.

**Risks that remain if shipped as-is (i.e., if the roadmap proceeds unchanged):**

- Revenue arrives late and unmeasured; the North Star slips with no early-warning checkpoint.
- The first customer onboards onto a system whose privacy controls are scheduled for *after* they arrive.
- Production depends on one operator's laptop at the exact moment it starts taking money.

**Sign-off:** I sign for **v0.1 as a foundation**. I sign for **the forward roadmap conditionally**, contingent on M1–M4 being addressed at or before the milestone each is tagged to (M1/M4 now; M2/S1 at v0.2; M3/S6 before v0.4). The architecture is sound; the *sequencing* is the risk. Reorder toward revenue and pull the controls forward, and this is a path to success.

---

**Summary:** 4 must-have + 6 strongly-recommended findings raised; 4 deferred. No findings auto-applied to v0.1 records (none exist to remediate); must-haves applied additively as **v0.2 Readiness Gates** in `ROADMAP.md` (Next Milestone). Deploy/merge/push items surfaced as operator-gated actions, not taken.
**Plan status:** v0.1 unchanged and intact. Forward path strengthened with explicit v0.2 entry gates. Ready for `/paul:discuss-milestone` (v0.2) with these gates in hand.

---
*Trajectory audit performed by PAUL Enterprise Audit Workflow (adapted: whole-project scope, no pending PLAN.md). Audit template version: 1.0.*
