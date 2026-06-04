---
phase: 02-design-system
plan: 03
status: complete
ac: AC-1 PASS, AC-2 PASS, AC-3 PASS, AC-4 PASS (operator-approved + Claude screenshot of authed shell)
completed: 2026-06-01
---

# Phase 2 Plan 03: App shell + routing fix + de-BSM — SUMMARY

**The authenticated app now embodies the PSG design system (navy sidebar + reverse logo + branded header/cards), the `/dashboard` 404 is fixed at the root, and BSM is gone app-wide. Build + typecheck green; 136 tests pass; operator approved the dashboard screenshot.**

## Shipped
| Item | Result |
|------|--------|
| App shell (`dashboard/layout.tsx`) | Navy `bg-sidebar` aside + `<Logo variant=reverse>`; Gotham nav (hover→ember); header with "CLIENT HUB" eyebrow + brand sign-out; reverse logo renders correctly on navy. AC-1 PASS |
| **Routing fix (root cause)** | Renamed route GROUP `app/(dashboard)/` → real SEGMENT `app/dashboard/`. Resolves the `/` collision (`app/page.tsx` + `(dashboard)/page.tsx` both mapped to `/`, leaving the dashboard unreachable) AND makes every existing `/dashboard*` reference correct (middleware guard, `app/page.tsx` redirect, billing return URLs, content links, onboarding-wizard, tier-gate). Sidebar hrefs + login/signup redirects → `/dashboard*`. AC-2 PASS |
| De-BSM (app-wide) | onboarding heading, 2 ads modals, google callback in-copy "BSM" → PSG; `grep -rniE "bsm\|body shop marketer" src` = none. AC-3 PASS |
| Primitives | card → 6px + hairline border + shadow-sm (no ring); badge += success(sage)/warning(amber) tones; table head → Gotham uppercase eyebrow + muted. AC-4 (primitives) PASS |
| Verify | `tsc --noEmit` 0; `next build` 0 (route table shows `/dashboard/*`, single `/`, `/login`, `/signup`); `vitest` 14 files / 136 tests pass; curl: `/dashboard*` now 307→/login unauth (was 404). Claude screenshotted the authed dashboard, then operator approved. |

## Deviation (flagged at checkpoint, operator-approved)
Plan said "fix LINKS to match existing routes / don't move files." Reality: the routes themselves were wrong (group-vs-segment collision making the dashboard unreachable). The correct, lower-churn fix was the folder rename `(dashboard)`→`dashboard`, which fixed all `/dashboard*` refs at once. One stale test import (`@/app/(dashboard)/billing/...`) updated to the new path.

## Deferred (minor)
- Active-nav highlight: nav has hover→ember but no current-route indicator (server layout; would need a small client nav component). Polish, not blocking.
- Eyebrow text on /login duplicates the logo's baked-in subtext (from 02-02) — revisit if desired.

## Files
- Renamed: `app/(dashboard)/**` → `app/dashboard/**` (git mv, ~17 files)
- Modified: `dashboard/layout.tsx` (shell rewrite + nav), `components/auth/{login,signup}-form.tsx` (redirect→/dashboard), `dashboard/onboarding/page.tsx`, `dashboard/ads/{campaign-detail,create-campaign}-modal.tsx`, `api/ads/google/callback/route.ts`, `components/ui/{card,badge,table}.tsx`, `dashboard/ads/__tests__/components.test.tsx` (import path)
