---
phase: 02-design-system
plan: 02
status: complete
ac: AC-1 PASS, AC-2 PASS, AC-3 PASS, AC-4 PASS (operator-approved + Claude screenshot)
completed: 2026-06-01
---

# Phase 2 Plan 02: Branded /login slice — SUMMARY

**`/login` + `/signup` now visibly embody the PSG design system: PSG logo, ember eyebrow → Gotham headline, paper background, midnight-navy primary button, single ember accent. Shared button/label primitives restyled to DS spec (inherited app-wide). De-BSM'd incl. browser-tab title. Build + typecheck green. Operator approved the screenshot.**

## Shipped
| Item | Result |
|------|--------|
| Logo | 3 DS-reconstruction SVGs copied to `public/brand/`; `<Logo variant=primary\|reverse\|mark>` component (`src/components/brand/logo.tsx`). AC-1 PASS |
| button.tsx | Gotham + 0.04em tracking; default=midnight (hover /90), outline=outline-navy, ghost=ember-hover, +accent=ember; ember focus ring retained. AC-2 PASS |
| label.tsx | Gotham (font-heading). input.tsx left as-is (already token-driven: ember `ring-ring`, 6px). |
| login + signup pages | Rebuilt: `<Logo>`, ember eyebrow "PHOENIX SOLUTIONS GROUP", Gotham headline, paper bg, brand form. De-BSM'd. |
| login-form / signup-form | Removed redundant CardHeader/CardTitle (page carries headline); logic untouched. |
| layout.tsx | metadata title → "Phoenix Solutions Group" (was "Create Next App"). |
| Verify | `tsc --noEmit` 0; `next build` "Compiled successfully" (28 routes); no BSM/teal on slice; Claude screenshot reviewed vs DS, then operator "approved". |

## Decisions
- Logos = DS reconstruction placeholder (operator-approved); product name "Phoenix Solutions Group".
- Dev verification needs the gitignored `.env.local` (Supabase URL+anon via MCP) — authenticated session in Chrome required signout to view `/login`.

## Found (deferred to 02-03 — NOT 02-02 scope)
- **`/dashboard` is a 404 (real bug):** post-login `router.push("/dashboard")` + all sidebar nav links target `/dashboard`, but the dashboard page is at route `/` (route group `(dashboard)` adds no path segment). BSM-inherited routing defect. Fix in 02-03 (app shell): align routes/links, or move the page under a real `/dashboard` segment.
- Eyebrow text duplicates the logo's baked-in "PHOENIX SOLUTIONS GROUP" subtext — minor; revisit in shell polish.

## Files
- Added: `public/brand/psg-logo-primary.svg`, `psg-logo-reverse.svg`, `psg-mark.svg`, `src/components/brand/logo.tsx`
- Modified: `src/components/ui/button.tsx`, `label.tsx`, `src/app/(auth)/login/page.tsx`, `signup/page.tsx`, `src/components/auth/login-form.tsx`, `signup-form.tsx`, `src/app/layout.tsx`
