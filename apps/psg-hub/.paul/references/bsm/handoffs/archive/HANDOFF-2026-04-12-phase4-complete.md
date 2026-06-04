# PAUL Session Handoff

**Session:** 2026-04-12
**Phase:** 4 of 7 (Customer-facing MVP) — Complete
**Context:** Completed Phase 3 plan 05 (site designer agent) + full Phase 4 (customer dashboard)

---

## READ THIS FIRST

You have no prior context. This document tells you everything.

**Project:** BSM (Body Shop Marketer) -- five AI agents that continuously optimize collision repair shop websites
**Core value:** Collision repair shops get continuous, data-driven marketing optimization without hiring agencies or learning marketing themselves.
**Location:** /Users/schoolcraft_mbpro/apps/apps/bsm/

---

## Session Accomplishments

### Phase 3, Plan 05: Site Designer Agent
- Created bsm-site-designer agent skill at ~/.claude/skills/bsm-site-designer/SKILL.md (274 lines)
- Upgraded preview/extract-template.js with page-type argument, layouts.json generation, platform detection
- Upgraded preview/generate-preview.js with layouts loading, page-type resolution, paragraph wrapping fix
- Registered site-designer as 5th agent in paperclip.config.json (runs first at onboarding)
- Fixed FA icons (JS/SVG rendering instead of CSS webfonts for file:// CORS)
- Fixed content styling (Glacial Indifference headings, Open Sans body, maroon accents)

### Phase 4: Customer-facing MVP (3 consolidated plans)

**Plan 04-01: App Scaffold + Auth + Multi-tenant**
- Created Next.js 15 app in dashboard/ with App Router, TypeScript, Tailwind
- PSG brand design system with oklch color tokens (Authority Palette + Clarity Teal)
- shadcn/ui components (button, input, card, label, badge, table) styled to brand
- Supabase Auth with email/password login/signup
- Auth middleware protecting /dashboard/* routes
- Multi-tenant PostgreSQL schema: profiles, shops, shop_members, content_items, agent_runs (001_initial_schema.sql)
- RLS policies (7 policies) with get_user_shop_ids() helper function
- Profile auto-creation trigger on auth.users insert

**Plan 04-02: Dashboard Views + Approval Workflow**
- Content list page with status-colored badges (draft/pending/approved/published/rejected)
- Content detail page with safe markdown preview renderer
- Approve/Reject buttons + API routes (POST /api/content/[id]/approve, /reject)
- Agent activity page with status cards for all 5 agents
- Shop settings page (read-only profile display)
- ContentTable, ContentPreview, ApprovalActions, AgentStatusCard components

**Plan 04-03: Stripe Billing + Onboarding Wizard**
- Stripe Checkout integration (Essentials $199/mo, Growth $499/mo)
- Customer Portal for subscription management
- Webhook handler for checkout.session.completed, subscription.updated, subscription.deleted
- Billing migration (002_billing.sql): subscriptions table with RLS
- 3-step onboarding wizard: shop name, address, website/phone
- Lazy Stripe initialization via getStripe() to avoid build-time env errors

---

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Consolidated Phase 4 from 6 plans to 3 | Less ceremony overhead, more context for implementation | Same scope, half the plan/apply/unify cycles |
| PSG brand with oklch colors | shadcn v4 uses oklch natively, cleaner than hex conversion | Teal primary, navy sidebar, gold accent throughout |
| Safe markdown rendering (no raw HTML) | Security hook blocked raw HTML injection | ContentPreview parses markdown paragraphs/headers/lists safely |
| Lazy Stripe init via getStripe() | Stripe SDK fails at build time without env vars | All routes build cleanly without STRIPE_SECRET_KEY set |
| Stripe API version 2026-03-25.dahlia | Installed SDK requires it (basil rejected by type checker) | Subscription types changed, used `any` cast for current_period_end |
| Supabase joins typed as `any` | Join returns array or object ambiguously depending on query | Settings page handles both array and object relation shapes |
| middleware.ts (not proxy.ts) | Next.js 16 deprecated middleware.ts but it still works | Shows warning in build, migrate to proxy.ts in future pass |

---

## Gap Analysis

### Supabase Project Not Connected
**Status:** DEFER
**Notes:** Dashboard builds but has no Supabase project configured. Need to create project and set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
**Effort:** S (15 min)

### Stripe Not Connected
**Status:** DEFER
**Notes:** Need Stripe account with two subscription products. Set STRIPE_SECRET_KEY, STRIPE_ESSENTIALS_PRICE_ID, STRIPE_GROWTH_PRICE_ID, STRIPE_WEBHOOK_SECRET in .env.local
**Effort:** S (15 min)

### middleware.ts Deprecation
**Status:** DEFER
**Notes:** Next.js 16 wants proxy.ts. Current middleware.ts works but shows build warning.
**Effort:** S (rename + minor adjustments)

### Content Preview HTML Sanitization
**Status:** DEFER
**Notes:** ContentPreview uses paragraph-level markdown parsing. Add DOMPurify when full HTML rendering is needed.
**Effort:** S

### Paperclip Runtime Registration
**Status:** DEFER
**Notes:** paperclip.config.json has 5 agents but only 4 registered in running Paperclip server. Site-designer needs runtime registration.
**Effort:** S

### Dashboard Sidebar Navigation (Mobile)
**Status:** DEFER
**Notes:** Sidebar is hidden on mobile (lg:flex). No hamburger menu yet.
**Effort:** M

---

## Open Questions

- None blocking. All architectural decisions made during init and prior phases.

---

## Infrastructure Status

| Service | Status | Notes |
|---------|--------|-------|
| Paperclip server | Running | http://127.0.0.1:3100 |
| Embedded PostgreSQL | Running | port 54329 |
| Sanity (BSM project) | Active | Project 436nqu7v, dataset: production |
| Next.js dashboard | Built | dashboard/ dir, needs Supabase + Stripe env vars |
| SEMrush API | Connected | .env |
| BigQuery | Connected | .env |
| Firecrawl | Connected | .env |

---

## Reference Files for Next Session

```
@.paul/STATE.md
@.paul/ROADMAP.md
@.paul/PROJECT.md
@.paul/phases/04-customer-facing-mvp/04-01-SUMMARY.md
@.paul/phases/04-customer-facing-mvp/04-02-SUMMARY.md
@.paul/phases/04-customer-facing-mvp/04-03-SUMMARY.md
@dashboard/src/app/(dashboard)/layout.tsx
@paperclip.config.json
@supabase/migrations/001_initial_schema.sql
@supabase/migrations/002_billing.sql
```

---

## Prioritized Next Actions

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Create Supabase project, apply migrations, set env vars | S |
| 2 | Create Stripe products (Essentials/Growth), set env vars | S |
| 3 | Run dashboard dev server and test full auth flow | S |
| 4 | /paul:plan Phase 5 (Reputation and ads) | M |
| 5 | Migrate middleware.ts to proxy.ts | S |

---

## State Summary

**Current:** Phase 4 complete, 4 of 7 phases done, milestone at 90%
**Next:** Set up Supabase + Stripe, then Phase 5 (Reputation and ads)
**Resume:** `/paul:resume` then read this handoff

---

*Handoff created: 2026-04-12*
