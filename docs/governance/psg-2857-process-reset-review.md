# PSG-2857 Process Reset and Delivery Recovery Plan

**Issue:** PSG-2857 - WE NEED TO RESET AND RESTRUCTURE PROCESSES
**Owner:** Steve (CEO) / PSG leadership
**Prepared by:** Ada (Chief Developer)
**Date:** 2026-08-19
**Revision:** 2, revised after Nick's change request on PSG-2858

## 1) Executive Summary

BSM is not failing because agents need another checklist. It is failing because the
team does not have a reliable trunk, a shared deployed demo surface, or evidence
that proves which build was tested. That lets work look complete in one branch or
one local environment while production and QA are seeing something different.

Nick's review found the structural problem:

- A large body of work is stranded away from `main`.
- The active recovery branch is both ahead of and behind `origin/main`.
- A merge comparison shows hundreds of changed files and many duplicate/conflicting
  paths.
- Some deployed builds were created from dirty working trees, which means git was
  bypassed.
- The earlier plan cited demo seed/runbook files that are not all present on
  `origin/main`.

The reset must therefore happen in this order:

1. Freeze unmanaged merging and direct deploys.
2. Recover a real trunk by reconciling stranded work into one controlled branch.
3. Stand up one verifiable demo surface that tracks the recovered trunk.
4. Only then enforce the definition of done, branch rules, QA gates, and weekly
   pending-to-main sweeps.

## 2) Verified Current State

This revision is grounded in the repo and Nick's PSG-2858 review.

Nick's review evidence on 2026-08-19:

- `331` commits across `14+` tickets were stranded on
  `feat/psg-790-tedesco-lead-endpoint`.
- A dry merge produced `102` conflicting files.
- There were `247` local branches and `175` remote branches.
- The oldest unmerged remote branch was from `2026-05-28`.
- Production at `hub.psgweb.me` serves `main`.
- Several Vercel deploys showed dirty working trees.

Ada's recheck in this heartbeat:

- Current branch: `feat/psg-790-tedesco-lead-endpoint`.
- Current local branch position: `331` commits ahead of `origin/main` and `167`
  commits behind `origin/main`.
- `git diff origin/main...HEAD` reports `512` changed files.
- Branch counts still match Nick's finding: `247` local and `175` remote.
- `origin/main` currently includes `apps/psg-hub/e2e/demo-fixtures.ts` and
  `apps/psg-hub/package.json`, but not all demo seed and walkthrough artifacts
  cited by revision 1.

## 3) What Exists, What Does Not, and What This Means

The demo verification path is a candidate foundation, not yet a dependable trunk
standard.

Present in this checkout:

- `apps/psg-hub/scripts/seed-superadmin-qa-env.mjs`
- `apps/psg-hub/scripts/seed-bsm-governance-demo.mjs`
- `apps/psg-hub/e2e/demo-fixtures.ts`
- `apps/psg-hub/e2e/focused-bsm-walkthrough.spec.ts`
- `apps/psg-hub/e2e/superadmin-walkthrough.spec.ts`
- `apps/psg-hub/docs/runbooks/clean-bsm-demo-login-walkthrough.md`
- `apps/psg-hub/package.json` scripts `seed:bsm-demo` and `seed:superadmin-qa`

Present on current `origin/main` from the checked local ref:

- `apps/psg-hub/e2e/demo-fixtures.ts`
- `apps/psg-hub/package.json`

Not confirmed on current `origin/main`:

- `apps/psg-hub/scripts/seed-superadmin-qa-env.mjs`
- `apps/psg-hub/docs/runbooks/clean-bsm-demo-login-walkthrough.md`
- `apps/psg-hub/e2e/focused-bsm-walkthrough.spec.ts`
- `apps/psg-hub/e2e/superadmin-walkthrough.spec.ts`

Implication: no one should enforce the demo process as the company standard until
the demo seed, walkthrough, and tests are merged to trunk, deployed, and proven.

Use `pnpm`, not `npm`, for this repo. The root package manager is `pnpm@9.15.0`.

## 4) Recovery Plan

### Phase 0 - Freeze and Inventory, 1 business day

Owner: Ada.

Rules during the freeze:

- No direct production deploys from local machines.
- No Vercel CLI deploys from dirty working trees.
- No independent merges to `main`.
- Critical production fixes may still ship, but only through a named hotfix path
  with Nick visibility.

Deliverables:

- Create a recovery tag for current `main`.
- Create a recovery tag for the stranded branch head.
- Export the full branch and commit inventory.
- Create a conflict inventory for the recovery branch versus `main`.
- Publish the duplicate-file policy before resolving conflicts:
  - if both sides add the same file, keep the version with passing tests and the
    more recent accepted task evidence;
  - if both sides implement different behavior, split into explicit follow-up
    issues rather than silently choosing one;
  - if customer-facing behavior changes, require QA and Nick review before
    production promotion.

### Phase 1 - Reconcile to a Real Trunk, 3-5 business days

Owner: Ada for merge queue and final technical decisions. Ravi and Nora own
assigned conflict batches. Tess owns QA evidence.

Goal: produce one recovery branch that can become `main` without another hidden
merge pass.

Required work:

- Resolve the recovery branch against current `origin/main`.
- Keep a written conflict log for each resolved area.
- Run targeted tests by area, not the entire suite by default.
- Build and deploy a branch preview.
- Verify the preview before `main` moves.
- Merge to `main` only after Tess's QA pass and Nick's approval for customer-facing
  impact.

Success target:

- Stranded commits ahead of `main`: `0`.
- Known merge conflicts: `0`.
- Recovery branch deployed preview has a visible build commit SHA.

### Phase 2 - Stand Up the Shared Demo Verification Surface, 2-3 business days

Owner: Ada for technical setup. Tess owns repeatable QA script. Nick owns final
business approval before public/customer-facing use.

Required surface:

- `demo.psgweb.me` or equivalent trunk-tracking alias points to the latest `main`
  deployment automatically.
- `hub.psgweb.me` remains customer/promote-gated.
- The app exposes the deployed commit SHA through a health endpoint or visible
  footer/admin surface so agents can prove what they tested.
- The demo path uses one Riverside demo tenant with three role logins:
  operator, shop, and internal.
- Credentials live only in the approved secret store, referenced by secret name,
  never by value in tickets, docs, screenshots, or commits.

Current blockers that must be resolved before the demo account can be treated as
ready:

- PSG-2836: production service-role key must be available in the proper secret
  store.
- PSG-2683: production migrations must be applied or drift must be cleared for
  the tables the seed writes.
- PSG-2835: Riverside demo metrics must be aggregate-derived rather than
  hardcoded fixtures.

Verification evidence required for every feature after this phase:

- Build SHA verified.
- Demo surface URL.
- Role login used: operator, shop, or internal.
- Exact assertion that passed.
- Test or walkthrough command, with result.
- Screenshots only as supporting proof, not as the primary proof.

### Phase 3 - Governance and Ongoing Delivery Rules, 2 business days

Owner: Ada for engineering governance. Tess for QA gate. Nick for public/customer
approval gate.

Definition of done:

- The work is merged to `main` or explicitly marked as not release-bound.
- The deployed build SHA containing the work is named.
- The standard demo path proves the affected role can use the feature.
- The Paperclip issue includes the exact assertion and verification command.
- User-facing work has Tess QA before it is called done.
- Public/customer-facing work has Nick approval before it goes live.

Branch and release guardrails:

- Protect `main`: pull request required, green focused checks required, no direct
  pushes except approved emergency hotfix.
- One named merge queue owner: Ada.
- Branch lifetime cap: branches older than 7 days need a comment explaining the
  blocker or are moved into recovery triage.
- Remote branch target after cleanup: under 20.
- No production deployment from dirty working trees.
- Vercel production deploys come from GitHub refs, not local state.

Weekly pending-to-main sweep:

- Baseline metrics: stranded commits, open conflicts, remote branches, oldest
  unmerged branch age, and done issues lacking reproducible evidence.
- Target state: `0` stranded commits, `0` known conflicts, fewer than `20` remote
  branches, oldest unmerged branch under `7` days.
- Any "done" issue without reproducible demo evidence is reopened or moved to
  retest. PSG-2783 is the first example to audit because it was marked done while
  the seed path was still not runnable.

## 5) Delegated Workstreams

These should be child issues under PSG-2857 after Nick approves this revised plan:

- Ravi: conflict inventory and resolution batch for API/server-side app changes.
- Nora: conflict inventory and resolution batch for UI, demo, and E2E files.
- Tess: recovery QA plan and shared demo regression checklist.
- Ada: merge queue, branch protection rules, Vercel deployment policy, and final
  integration review.
- Nick: review and approve the revised plan before trunk recovery changes move
  to production-facing `main`.

## 6) Business Impact

This reset changes the business outcome in four ways:

- PSG stops calling work complete when it only works in one local branch.
- Steve and Nick can see which features are truly in the build customers will use.
- Agents get one demo account path, reducing duplicated setup and contradictory
  test results.
- Production releases become slower for a few days, then faster and safer because
  work no longer piles up outside `main`.

## 7) Approval Request

Recommendation: approve this revised recovery plan.

Decision needed from Nick:

1. Approve the freeze, recovery branch, and merge queue approach.
2. Approve `demo.psgweb.me` or equivalent as the trunk-tracking verification
   surface while keeping `hub.psgweb.me` promote-gated.
3. Approve the Riverside demo tenant contract with three role logins.
4. Approve the target numbers: `0` stranded commits, `0` conflicts, under `20`
   remote branches, oldest unmerged branch under `7` days.

If approved, Ada will create the delegated child issues and start Phase 0
immediately.

## 8) Acceptance Checklist for PSG-2857

- [ ] Revised plan approved by Nick.
- [ ] Phase 0 inventory published.
- [ ] Recovery tags created before merge work starts.
- [ ] Merge conflict policy published.
- [ ] Recovery branch preview verified with visible build SHA.
- [ ] Demo credentials blockers PSG-2836, PSG-2683, and PSG-2835 resolved or
      explicitly scheduled with owners and dates.
- [ ] `main` protected and release path limited to GitHub refs.
- [ ] Weekly pending-to-main sweep started with numeric baseline and targets.

## 9) SOPs and References Checked

- Relevant SOPs checked: board communication standard, board escalation/review
  standard, Graphify code-navigation rule.
- Engineering reference checked: `Reference.md`.
- Graphify runbook checked: `docs/runbooks/graphify-codebase-graph.md`.
