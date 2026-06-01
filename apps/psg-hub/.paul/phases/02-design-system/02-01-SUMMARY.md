---
phase: 02-design-system
plan: 01
status: complete-for-scope
tasks: 2 of 2 auto + 1 checkpoint (reclassified)
ac: AC-1 PASS, AC-2 PASS, AC-3 PASS, AC-4 reframed (see reconciliation)
completed: 2026-06-01
---

# Phase 2 Plan 01: Design-system submodule + brand token swap — SUMMARY

**Delivered the brand-token + font foundation. Vendored the design-system submodule, wired Gotham + Didact Gothic, swapped BSM "Clarity Teal" → PSG midnight/ember tokens across every shadcn var, deleted the orphan tokens.css. Build + typecheck green. The human-verify checkpoint surfaced an INTENT/SCOPE gap (the app should embody the full design system — logo, brand components, layout — not just recolored shadcn); that is being addressed by an expanded Phase 2 re-plan, NOT a defect in this plan.**

## What shipped

| Item | Result |
|------|--------|
| Submodule `packages/ui/psg-brand/` | Added, pinned `1689896`; `.gitmodules` tracked. AC-1 PASS |
| Fonts | Gotham (300/400/500/700/800) + Didact Gothic via `next/font/local` from submodule; Geist removed; 6 font files emitted to `.next`. AC-2 PASS |
| Tokens | `globals.css` `:root`/`.dark` re-valued from `colors_and_type.css` (midnight `#1E3A52` primary, ember `#B8483E` ring/destructive/active, paper `#FAFAFA`, radius 6px, brand chart series, brand extras). Compiled CSS confirmed `1e3a52`/`b8483e`/`fafafa`, zero `0d9488`/`d4a853`. AC-3 PASS |
| Orphan removal | `src/styles/tokens.css` (BSM teal) deleted; no dangling import |
| Build / typecheck | `next build` ✓ "Compiled successfully", 28 routes; `tsc --noEmit` exit 0 |

## Deviations / fixes

- **Font loader literal fix (code):** first `fonts.ts` built `next/font/local` paths from a `FONTS` variable → "Font loader values must be explicitly written literals" build error. Rewrote with inline literal paths. Re-build green. (Qualify GAP → fixed in 1 loop.)
- **Heading base rule added:** added `h1–h6 { @apply font-heading }` to `@layer base` so Gotham renders on headings (beyond the plan's literal token-only spec; consistent with the DS, which applies Gotham to headings globally).

## Checkpoint reconciliation (AC-4)

AC-4 (human-verify brand conformance) was reframed, not failed:
- The part 02-01 owned — brand **tokens + fonts** render correctly (navy/ember/paper/Gotham, no teal) — is verified true in the served output.
- Operator feedback ("doesn't look like the PSG design system — where's the logo") revealed Phase 2's intent is broader than the ROADMAP's "brand token swap" line: the app must embody the design system's **visual identity** (logo, brand-styled components per `preview/components-*.html`, PSG layout vocabulary). That is NEW scope, captured in the expanded Phase 2 re-plan (02-02+), not a defect here.
- Decision (operator, 2026-06-01): `colors_and_type.css` is canonical on DS internal contradictions (paper `#FAFAFA`, headings Bold 700) — so the values shipped here are correct; no token rework needed.

## Carry-overs

- **Dev unblock (Phase 3 preview):** wrote a gitignored `apps/psg-hub/.env.local` with `NEXT_PUBLIC_SUPABASE_URL` + anon key (pulled via Supabase MCP for project `gylkkzmcmbdftxieyabw`) so `/login` renders for visual checks. Full env (service role, feature keys) lands in Phase 3. Not committed (`.env*` gitignored).
- Submodule repo is PRIVATE → Vercel deploy key required at Phase 3.
- Gotham is Adobe Typekit-licensed → self-hosting `.otf` flagged for operator.

## Files
- Added: `.gitmodules`, `packages/ui/psg-brand` (submodule), `apps/psg-hub/src/lib/fonts.ts`
- Modified: `apps/psg-hub/src/app/layout.tsx`, `apps/psg-hub/src/app/globals.css`
- Deleted: `apps/psg-hub/src/styles/tokens.css`
