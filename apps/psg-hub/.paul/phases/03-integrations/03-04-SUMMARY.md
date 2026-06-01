---
phase: 03-integrations
plan: 04
subsystem: infra
tags: [vercel, nextjs, monorepo, submodule, dns, env, turborepo, deploy]

requires:
  - phase: 02-design-system
    provides: psg-brand submodule (Gotham/Didact fonts + PSG tokens + Logo), branded /login + app shell, /dashboard route-segment fix
  - phase: 03-01-sendgrid
    provides: SendGrid mail adapter + /api/webhooks/sendgrid + env contract
  - phase: 03-02-twilio
    provides: Twilio SMS adapter + /api/webhooks/twilio + env contract
  - phase: 03-03-sanity
    provides: Sanity project vcw0bsnu (private prod dataset) + env contract
provides:
  - NEW Vercel project psg-hub (prj_CBrI1FRqqgPzCbAwin6LbSknY48U, team psg-digital), root dir apps/psg-hub, framework Next.js
  - psg-hub LIVE at https://hub.psgweb.me (branded, Let's Encrypt cert, submodule + Phase 3 prod env)
  - proven Vercel build recipe (root dir + include-outside-root + framework via vercel.json)
  - production env wired (13 Phase 3 keys)
affects: [03-05 webhook live-verify + data/BSM decommission, phase-3-transition, future git-connect]

tech-stack:
  added: [apps/psg-hub/vercel.json (framework:nextjs)]
  patterns: [CLI-driven prod deploy from branch (no git-connect → no clobber-window); env wired via CLI stdin from gitignored .env.local; turbo.json build env[] for server secrets]

key-files:
  created: [apps/psg-hub/vercel.json, .paul/phases/03-integrations/03-04-SUMMARY.md]
  modified: [.vercelignore, turbo.json, .paul/phases/03-integrations/03-04-PLAN.md, .paul/STATE.md]

key-decisions:
  - "NEW Vercel project instead of re-linking data (operator checkpoint:decision; supersedes D54 mechanism, intent intact)"
  - "Zero-config except framework: vercel.json {framework:nextjs} (bare project defaulted to Other)"
  - "Deploy via vercel --prod from branch (not git-connected) → no main auto-deploy armed → clobber-window avoided"

patterns-established:
  - "Phase 3 env wired via CLI stdin from .env.local (values never echoed); preview env deferred until git-connect"
  - "turbo.json build task env[] declares server secrets (NEXT_PUBLIC_* are framework-inferred)"

duration: ~75min
started: 2026-06-01T18:00:00Z
completed: 2026-06-01T19:15:00Z
---

# Phase 3 Plan 04: Vercel deploy of psg-hub — Summary

**psg-hub is LIVE at https://hub.psgweb.me — branded (PSG logo + midnight/ember/paper + Gotham/Didact), built from the monorepo + private psg-brand submodule, all Phase 3 production env wired, valid Let's Encrypt cert — deployed to a NEW `psg-hub` Vercel project (operator pivoted away from re-linking the broken `data` portal).**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: psg-hub builds from monorepo at root dir apps/psg-hub (submodule + workspace resolve) | **PASS** | Local clean prod build green: submodule Gotham/Didact via next/font/local relative literals + PSG tokens resolve, .next produced, "Compiled successfully". Recipe captured (vercel.json framework + dashboard root-dir/outside-root). |
| AC-2: project configured + Phase 3 env wired | **PASS** (re-spec'd) | NEW psg-hub project (re-spec from re-link `data`). Root dir apps/psg-hub, "include outside root" ON, framework Next.js, Node 24.x. 13 prod env keys wired (Supabase intact path: URL+ANON; SendGrid×3; Twilio×3 + WEBHOOK_BASE_URL; Sanity×4). `data` untouched. |
| AC-3: psg-hub live at https://hub.psgweb.me | **PASS** | /login HTTP 200 branded; /dashboard 307→/login (no 404/500); / 307→/login; webhook routes /api/webhooks/{sendgrid,twilio} live (400 sig-reject, 405 GET = deployed, not 404); Let's Encrypt cert CN=hub.psgweb.me. Deferred 03-01/03-02 webhook live-verifies explicitly carried OPEN → 03-05. |

## Verification Results

```
Local build:   pnpm build → "✓ Compiled successfully in 7.9s" + .next produced; routes incl /api/webhooks/{sendgrid,twilio}
Vercel build:  vercel --prod → "Build Completed [42s]" framework=nextjs (Proxy middleware + static/dynamic); no turbo env warning
Render (live): GET https://hub.psgweb.me/login → 200 (Gotham/Didact/PSG/Phoenix/ember markers); /dashboard → 307→/login
Webhooks live: POST /api/webhooks/sendgrid → 400; POST /api/webhooks/twilio → 400; GET both → 405 (route live, not 404)
Cert:          Let's Encrypt, CN=hub.psgweb.me; DNS → vercel-dns-016.com / 216.150.x
```

## Accomplishments

- psg-hub publicly reachable + fully Phase-3-env-wired at hub.psgweb.me — gives 03-05's webhook live-verifies a stable public URL to fire against.
- Avoided the plan's #1 hazard (routeless-main clobber) entirely by deploying to a fresh, not-git-connected project from the branch.
- Proven, documented, minimal build recipe for the monorepo + private submodule (one-line vercel.json; rest is dashboard + .vercelignore + turbo env).

## Task Commits

Not yet committed at SUMMARY authoring — operator requested commit+push at UNIFY (this session). Branch `chore/phase-3-integrations`. Tracked changes below land in one plan-level commit (not a phase-transition commit — 03-05 remains).

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `apps/psg-hub/vercel.json` | Created | `{framework:nextjs}` — fixes bare project's Framework=Other; the conditional vercel.json AC-1 reserved |
| `.vercelignore` | Modified | Exclude `archive/`, `psg-data-lake/`, `api-psghub/`, `apps/psg-ads-mutations/` (first deploy hit 2 GiB cap; archived local copies, canonical data in Supabase) |
| `turbo.json` | Modified | build task `env[]` declares 8 Phase-3 server vars (+2 Supabase server, +Messaging-Service alt) — silences turbo strict-mode warning |
| `.paul/phases/03-integrations/03-04-PLAN.md` | Modified | AC-2 + Task 2 + clobber-boundary re-spec'd: re-link `data` → create NEW project |
| `.paul/phases/03-integrations/03-04-SUMMARY.md` | Created | This file |
| `.paul/STATE.md` | Modified | Decision logged, APPLY/UNIFY execution log, loop position |

**Vercel-side (not in repo):** psg-hub project + 13 prod env keys + hub.psgweb.me domain. `.vercel/` stays gitignored.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| NEW Vercel project, not re-link `data` | Live verify + 4-agent adversarial workflow: `data` = 33d non-customer portal, last 9h all Error deploys, no custom domain, env = 4 portable keys, analytics hollow; re-link would ARM routeless-main clobber (REAL_LOCKIN/high) | Supersedes D54 mechanism (intent intact — BSM/`data` still retired in 03-05). 03-05 gains a clean `data` DELETE. AC-2 re-spec'd. PLANNING.md left immutable (boundary). |
| vercel.json `{framework:nextjs}` | Bare CLI-created project defaulted Framework=Other (re-link would've inherited Next.js) | One tracked file; reproducible for future git deploys |
| Deploy CLI `--prod` from branch, project NOT git-connected | Branch has the webhook routes, main doesn't; no git trigger = no clobber-window | Git-connect + submodule GitHub-app grant + Preview env deferred to post-03-05 main merge |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Spec re-spec (checkpoint:decision) | 1 | AC-2 mechanism changed (re-link → new project); AC-1/AC-3 unchanged |
| Auto-fixed | 2 | vercel.json framework gap; 2 GiB upload cap via .vercelignore |
| Scope additions | 1 | turbo.json build env[] (silence warning + correct hashing) |
| Deferred | 4 | Carried to 03-05 (see below) |

**Total impact:** No scope creep into app code; all changes are deploy-config or planning docs. Boundaries held.

### Auto-fixed Issues

**1. [infra] Framework preset = Other on bare project**
- Found during: Task 3 (pre-deploy settings check)
- Fix: `apps/psg-hub/vercel.json` `{framework:nextjs}`
- Verification: Vercel build ran next build + Proxy middleware + .next output

**2. [infra] First deploy rejected — 3.12 GB > 2 GiB upload cap**
- Found during: Task 3 (vercel --prod)
- Fix: extend root `.vercelignore` to exclude heavy archived dirs (none needed by psg-hub build; canonical data in Supabase)
- Verification: redeploy uploaded clean, build green 42s

### Deferred Items (→ 03-05)

- 03-01 SendGrid event-row webhook live-verify (needs SendGrid Event Webhook URL → hub.psgweb.me)
- 03-02 Twilio live signature-verify (needs StatusCallback/inbound URL → hub.psgweb.me)
- Wire `SUPABASE_DB_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-only; for webhook DB persistence)
- psg-hub git-connect + private-submodule GitHub-app grant + Preview env (post-03-05 main merge)
- Decommission old `data` Vercel + BSM Vercel (D54)

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Vercel REST API token (auth.json) = user/team scope only, no project-write | Used CLI session (works) for project create/env; operator set root-dir/outside-root toggles in dashboard |
| `vercel env pull` / branch-scoped preview env failed (non-interactive / no git) | Wired prod env via CLI stdin; preview env deferred to git-connect |
| hub.psgweb.me had stale A → 5.161.189.118 (Hetzner) | Operator repointed Cloudflare A → 76.76.21.21; Vercel verified + issued cert |

Skill audit: no `.paul/SPECIAL-FLOWS.md` → not applicable.

## Next Phase Readiness

**Ready:**
- Public branded URL (hub.psgweb.me) live for 03-05 webhook URL wiring + live-verify
- Webhook routes deployed + responding (400/405), prod env present
- `data` left clean for a one-click delete in 03-05

**Concerns:**
- Production not git-connected (by design) → manual `vercel --prod` until post-03-05 connect; main auto-deploy still on the untouched `data` (erroring harmlessly)
- Stripe webhook live but 500s (Stripe env not wired — out of scope, later phase)

**Blockers:** None for 03-05.

---
*Phase: 03-integrations, Plan: 04*
*Completed: 2026-06-01 — Phase 3 = 4/5 plans loop-closed; 03-05 remains (NOT phase-complete, no transition)*
