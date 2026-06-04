---
phase: 04-customer-facing-mvp
plan: 01
subsystem: foundation
tags: [nextjs, supabase, auth, rls, multi-tenant, shadcn, tailwind, psg-brand]

requires:
  - phase: 03-content-preview
    provides: Preview system and agent swarm
provides:
  - Next.js 15 app scaffold with PSG brand design system
  - Supabase Auth with email/password login/signup
  - Multi-tenant PostgreSQL schema with RLS
  - Dashboard shell with sidebar navigation
affects: [04-02, 04-03]

tech-stack:
  added: [next@15, @supabase/supabase-js, @supabase/ssr, shadcn-ui, tailwindcss]
  patterns: [app-router, route-groups, server-components, rls-multi-tenancy]

key-files:
  created:
    - dashboard/src/lib/supabase/client.ts
    - dashboard/src/lib/supabase/server.ts
    - dashboard/src/lib/supabase/middleware.ts
    - dashboard/src/middleware.ts
    - dashboard/src/app/(auth)/login/page.tsx
    - dashboard/src/app/(auth)/signup/page.tsx
    - dashboard/src/app/(dashboard)/layout.tsx
    - dashboard/src/app/(dashboard)/page.tsx
    - dashboard/src/components/auth/login-form.tsx
    - dashboard/src/components/auth/signup-form.tsx
    - dashboard/src/app/api/auth/signout/route.ts
    - dashboard/src/styles/tokens.css
    - dashboard/.env.example
    - supabase/migrations/001_initial_schema.sql

key-decisions:
  - "PSG brand: oklch colors with teal primary, navy sidebar, gold accent"
  - "Route groups: (auth) for login/signup, (dashboard) for protected pages"
  - "Supabase SSR pattern with separate client/server/middleware utilities"

duration: 15min
completed: 2026-04-12T23:30:00Z
---

# Phase 4 Plan 01: App Scaffold + Auth + Multi-tenant Schema

**Next.js 15 dashboard with Supabase Auth, PSG brand design system, and multi-tenant PostgreSQL schema with RLS.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Next.js scaffolded with PSG design system | Pass | Build succeeds, PSG oklch colors applied, shadcn/ui components installed |
| AC-2: Supabase Auth with login/signup | Pass | Login/signup pages render, middleware protects routes, signout API works |
| AC-3: Multi-tenant schema with RLS | Pass | 5 tables, 7 RLS policies, helper function, profile trigger |

## Files Created

| File | Purpose |
|------|---------|
| dashboard/ | Next.js 15 app (full scaffold) |
| dashboard/src/styles/tokens.css | PSG brand design tokens |
| dashboard/src/lib/supabase/*.ts | Supabase client/server/middleware utilities |
| dashboard/src/middleware.ts | Auth session refresh + route protection |
| dashboard/src/app/(auth)/ | Login and signup pages |
| dashboard/src/app/(dashboard)/ | Protected dashboard shell with sidebar |
| dashboard/src/components/auth/ | Login and signup form components |
| dashboard/.env.example | Required environment variables |
| supabase/migrations/001_initial_schema.sql | Multi-tenant schema with RLS |

## Deviations

None.

## Next Phase Readiness

**Ready:**
- Dashboard shell ready for feature views (Plan 04-02)
- Auth working for protected routes
- Schema ready for content and agent data

---
*Completed: 2026-04-12*
