# Special Flows

**Project:** ads-dashboard
**Created:** 2026-05-20

Specialized skills wired into the PAUL loop for this project. PAUL invokes these at the listed checkpoints to enforce design discipline, brand fidelity, and security rigor.

## Anti-AI-Slop Pillars (binding)

Every frontend phase must satisfy:
1. Zero generic "AI dashboard" aesthetic — no card-grid default, no gradient blobs, no decorative iconography
2. Brand tokens before components — Tailwind theme rebuilt from PSG palette/type
3. Story leads, number supports — KPI cards open with sentence; metric is evidence
4. Editorial rhythm — intentional asymmetry, varied density, real whitespace
5. Print-quality typography — type scale from brand, real hierarchy, no Inter-everywhere
6. Motion with restraint — transitions communicate state change, nothing decorative
7. Every state designed up-front — empty, loading, error, first-visit, no-data-yet
8. `/impeccable critique` gate before every frontend phase merge

## Configured Skills

| Skill | Phase / Checkpoint | Role |
|-------|-------------------|------|
| `/impeccable shape` | Entry of every frontend phase | Produce design brief before any UI code |
| `/impeccable craft` | During component build in frontend phases | Translate brief to implementation with discipline |
| `/impeccable critique` | Exit gate of every frontend phase | Scored review; must pass before merge — binding |
| `/brandkit` | Phase 1 — design tokens | Extract PSG tokens from design system zip + brand guidelines URL to `tokens/psg.json` |
| `/ui-ux-pro-max` | All frontend phases | Component patterns, color systems, accessibility, font pairing |
| `/supabase` | Phase 2 + RLS work | Supabase patterns, RLS policies, auth hooks for role + client_id claims |
| `/vercel:nextjs` | Phase 1 + ongoing | Next.js 15 App Router best practices |
| `/vercel:shadcn` | Phase 1+ | shadcn/ui scaffolding (token-overridden, never default-themed) |
| `/aegis:audit` | End of Phase 3 + final | Security audit, RLS validation, OWASP review |
| `/aegis:guardrails` | Pre-merge | Lightweight compliance check between major AEGIS audits |
| `/code-review:code-review` | Pre-merge for non-trivial plans | Standard code review pass |

## Sources

- PSG brand guidelines: https://phoenixsolutionsgroup.net/psg-brand-guidelines/
- PSG design system zip: `Library/CloudStorage/GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/02. Marketing/Brand Assets/Phoenix Solutions Group Design System.zip`

## Quality Gates Summary

| Gate | Threshold | When |
|------|-----------|------|
| `/impeccable critique` | passing score | Every frontend phase exit |
| Brand-token compliance | zero raw hex outside `tokens/` | Every frontend phase |
| RLS audit | zero cross-tenant leaks | Phase 3 + final |
| AEGIS audit criticals | zero | Phase 3 + final |
| Lighthouse | ≥90 all categories | Final phase |
| Accessibility | WCAG AA | Every frontend phase |
| SonarQube scan | no new criticals/blockers | Each phase exit |

---
*SPECIAL-FLOWS.md — Update via `/paul:flows`*
