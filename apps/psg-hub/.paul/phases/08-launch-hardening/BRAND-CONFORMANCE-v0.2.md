# Brand-Conformance Audit — v0.2 Customer Surface

**Phase 8 / 08-04 (S5 quality gate) · 2026-06-04 · method: static**

## Scope

The customer UI surface only:
- `src/app/dashboard/**` (dashboard routes: home, ads, agents, billing, content, reviews, settings, onboarding, layout)
- `src/components/dashboard/**` (shell + feature components)
- `src/app/globals.css` (token definitions / Tailwind 4 theme)

Out of scope: visual/screenshot conformance (→ 08-04b live-surface harness), the `packages/ui/psg-brand` submodule + Phase 2 token canon (DO-NOT-CHANGE boundary).

## Method

Static `grep` against the PSG design system canon (Phase 2, `colors_and_type.css`): midnight navy `#1E3A52`, phoenix ember `#B8483E`, paper `#FAFAFA`, restrained radius 6px (`--radius: 0.375rem`), Gotham (heading) + Didact Gothic (body). Scanned for:
1. BSM-era "Clarity Teal" leftovers (`clarity`, `teal`)
2. raw `oklch(...)` outside the token block (BSM used oklch teal vars)
3. boilerplate/template identity (`create-next-app`, Next.js logo, `vercel.svg`, starter copy)
4. BSM teal/cyan hexes (`#2dd4bf`, `#14b8a6`, `#0d9488`, `#5eead4`, `#99f6e4`)

## Findings

| # | Check | Customer-surface result | Disposition |
|---|-------|-------------------------|-------------|
| 1 | `clarity` / `teal` | CLEAN (0 hits) | Pass — no BSM Clarity-Teal residue |
| 2 | raw `oklch(` | CLEAN (0 hits in `src/`) | Pass — BSM oklch vars fully retired (Phase 2) |
| 3 | boilerplate identity | CLEAN (0 hits) | Pass — no Next.js template residue on the surface |
| 4 | BSM teal/cyan hexes | CLEAN (0 hits in `src/`) | Pass — no stray brand-foreign hexes |
| 5 | PSG tokens are source | PRESENT in `globals.css` (midnight `#1E3A52`, ember `#B8483E`, paper `#FAFAFA`, `--radius: 0.375rem`, `--font-gotham`/`--font-didact`) | Pass — single source of brand truth |
| 6 | Surface uses brand semantic classes | All color usage is via semantic tokens (`bg-primary`, `text-ember`, `bg-sidebar`, `text-muted-foreground`, `bg-card`, `border-primary`, …) — no inline hex/arbitrary colors | Pass — no token bypass |

Top class usage on the surface (sampled): `text-muted-foreground` (75), `text-foreground` (13), `bg-background` (13), `text-primary` (8), `bg-primary` (7), `text-ember` (4), `bg-sidebar` (3) — every one resolves to a PSG token in `globals.css`.

## Verdict

**PASS — the v0.2 customer surface is brand-conformant (static).** Zero BSM/Clarity-Teal/raw-oklch/boilerplate leftovers; all color + radius + type flow from the Phase-2 PSG token definitions via semantic classes. No source change required in 08-04.

## Residual (→ 08-04b)

Visual conformance (rendered spacing, eyebrow→headline rhythm, single-ember-accent discipline, logo treatment) is not statically checkable and is deferred to the 08-04b live-surface pass alongside Playwright/axe.
