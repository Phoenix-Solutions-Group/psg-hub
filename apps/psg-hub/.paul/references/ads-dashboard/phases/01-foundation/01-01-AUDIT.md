# Enterprise Plan Audit Report

**Plan:** `.paul/phases/01-foundation/01-01-PLAN.md`
**Audited:** 2026-05-20
**Verdict:** Conditionally acceptable → after applied upgrades: **enterprise-ready for Phase 1 foundation**

---

## 1. Executive Verdict

The plan as originally written was structurally sound but missed several baseline controls expected of a client-facing commercial service: pnpm version pinning, security headers, CI reliability primitives (concurrency, timeout, supply-chain check), production URL capture, robots.txt noindex policy, ownership documentation, automated dependency updates, and a security contact.

None of these are "future phase" problems — they are foundation-layer commitments that get harder to retrofit. Applied as must-have and strongly-recommended upgrades. Would sign off post-upgrade.

## 2. What Is Solid

- **Temp-dir scaffold + rsync** for `create-next-app` on a non-empty directory is the correct mechanism. Preserves `.paul/`, README.md, PLANNING.md, .git/ as required.
- **`.env.example` + gitignore policy** (only `.env.example` tracked) avoids the most common foot-gun.
- **Boundaries section is explicit** — protected paths and scope limits both stated up-front.
- **BDD acceptance criteria** are testable and isolated.
- **Scripts standardized** (`dev`, `build`, `start`, `lint`, `typecheck`) — CI hooks into one source.
- **Vercel deploy via Git integration** (no custom deploy job in CI) — correct separation of concerns; Vercel owns deploys, GitHub Actions owns checks.

## 3. Enterprise Gaps Identified

| # | Gap | Why It Matters |
|---|-----|---------------|
| 1 | pnpm version drift (local 10.32.1, CI v9) | Lockfile reproducibility breaks day 1; "works on my machine" failures. |
| 2 | No security headers | Client-facing service with auth tokens needs CSP/HSTS/X-Frame-Options at minimum; retrofitting CSP is materially harder than starting strict. |
| 3 | CI lacks concurrency control | Rapid PR pushes burn minutes; stale runs report against superseded commits. |
| 4 | CI lacks timeout | Hung step (network glitch, registry outage) sits forever. |
| 5 | CI lacks supply-chain check | Initial scaffold installs ~200+ transitive deps with no vetting. |
| 6 | T2 verify uses unset `$PROD_URL` | Plan claims AC-2 met without actually capturing the URL. Audit defect: assertion without evidence. |
| 7 | No robots.txt noindex | Future per-client slugs (e.g., `/c/wallace`) will be crawler-indexed; client-confidential URL leak risk. |
| 8 | No CODEOWNERS | Multi-tenant commercial service with no documented ownership is an audit finding. |
| 9 | No SECURITY.md / vulnerability disclosure | Standard expectation for any public-facing service. |
| 10 | No Dependabot | Manual dep updates degenerate; weekly automation catches CVEs early. |
| 11 | No rollback procedure documented | Vercel makes rollback trivial; absence of documented procedure is a process gap, not a tooling gap. |

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 1 | pnpm version drift | T1 action (4b added), T3 action (pnpm/action-setup@v4 without `version:`), frontmatter files_modified | Pin `packageManager: pnpm@10.32.1` in package.json; CI reads from there. AC-5 added. |
| 2 | Missing security headers | T1 action (4c added), AC-6, verification | next.config.ts `headers()` with CSP report-only, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy. AC-6 added. |
| 3 | CI no concurrency | T3 action (concurrency block added), AC-9 | `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`. AC-9 added. |
| 4 | CI no timeout | T3 action (timeout-minutes: 10), AC-9 | Bounded run time per job. |
| 5 | T2 verify unset PROD_URL | T2 verify rewritten, AC-7 added | URL captured via `vercel inspect`/`vercel ls`, curl-verified for 200 + security headers, recorded to `.paul/phases/01-foundation/.prod-url`. AC-7 added. |
| 6 | No robots.txt noindex | T1 action (4d added), AC-8, verification | `app/robots.ts` emits Disallow: /. AC-8 added. Lifts post-Phase 3 access-control validation. |

### Strongly Recommended

| # | Finding | Plan Section Modified | Change Applied |
|---|---------|----------------------|----------------|
| 7 | CI no supply-chain check | T3 action (pnpm audit step), AC-9 | `pnpm audit --prod --audit-level=high` step; fails on high/critical. |
| 8 | No CODEOWNERS | Task 4 added (.github/CODEOWNERS), AC-10 | `* @nmschoolcraft` default owner; expand when PSG team has GitHub. |
| 9 | No SECURITY.md | Task 4 added (SECURITY.md), AC-10 | `security@phoenixsolutionsgroup.net` contact + 2-day ack / 5-day remediation SLA. |
| 10 | No Dependabot | Task 4 added (.github/dependabot.yml), AC-10 | Weekly cadence, npm + github-actions ecosystems, grouped non-major updates, 5 PR limit. |
| 11 | No rollback procedure | `<output>` SUMMARY template | Vercel rollback procedure required in SUMMARY (dashboard promote or `vercel rollback`). |

### Deferred (Can Safely Defer)

| # | Finding | Rationale for Deferral |
|---|---------|----------------------|
| 1 | Husky / pre-commit hooks | Solo developer for now; CI catches the same issues. Re-evaluate when 2nd contributor lands. |
| 2 | Commit signing (signed commits/tags) | Phase 5 hardening; not required to ship Phase 1 foundation. |
| 3 | Schedule-based stale-dep scans | Dependabot weekly cadence + `pnpm audit` in CI together provide adequate coverage. |
| 4 | Vercel region pinning | Default Vercel region is fine until measured latency drives a change. |
| 5 | LICENSE file | Internal/proprietary code in private repo; not a release blocker. Add when first external collaborator or open-source decision is made. |
| 6 | Branch protection rules | GitHub UI configuration, not code. Document in SUMMARY but apply via dashboard separately. |

## 5. Audit & Compliance Readiness

- **Defensible evidence:** Post-upgrade, the plan produces an audit-defensible trail — production URL captured in writing, security headers verified via curl, pnpm audit results captured in CI logs, robots.txt policy explicitly noindex in code.
- **Silent failure prevention:** CI timeout + concurrency cancel + supply-chain check together eliminate the most common silent-failure modes for a foundation plan.
- **Post-incident reconstruction:** Rollback procedure documented in SUMMARY template; Vercel deploy history + git history provide the reconstruction trail.
- **Ownership:** CODEOWNERS makes accountability explicit. SECURITY.md provides external reporting channel.

Residual gap: branch protection rules (require status checks before merge) are GitHub UI config, not code — documented as a manual post-Phase 1 step in SUMMARY.

## 6. Final Release Bar

**Must be true before merge:**
- All 10 acceptance criteria pass.
- Production deploy responds 200 with all 5 security headers + robots.txt noindex.
- CI green on a real PR with concurrency cancellation verified.
- `pnpm audit --prod --audit-level=high` clean.
- packageManager field exactly matches CI runtime.

**Remaining risks if shipped post-upgrade:**
- CSP is report-only initially (intentional — tighten after auth + brand land; tracked as a Phase 2 follow-up).
- Branch protection requires manual GitHub UI step (documented in SUMMARY, not enforced by code).

**Sign-off:** Would sign my name to this foundation after upgrades land. The risks above are documented and time-boxed.

---

**Summary:** Applied **6 must-have + 5 strongly-recommended** upgrades. Deferred **6** items with rationale.
**Plan status:** Updated and ready for APPLY.

---
*Audit performed by PAUL Enterprise Audit Workflow*
*Audit template version: 1.0*
