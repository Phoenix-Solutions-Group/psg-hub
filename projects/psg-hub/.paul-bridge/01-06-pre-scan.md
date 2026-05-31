# 01-06 Pre-Scan — BSM siblings → packages/*

**Date:** 2026-05-31
**Plan:** 01-06 (Wave 2) — relocate BSM siblings to `apps/psg/packages/*` scoped `@psg/*`
**Status:** Pre-scan complete. BLOCKING at checkpoint — plan premise mismatch found (see §Decision).

---

## CRITICAL FINDING: 4 of 5 "siblings" are NOT packages

Plan assumes "five BSM sibling **packages**." Reality: only `studio` is a real npm/workspace package. The other four are docs / content / loose scripts with **no package.json**.

| Sibling | Size | package.json? | What it actually is | Pre-clean target |
|---------|------|---------------|---------------------|------------------|
| **studio** | 578M | YES — `name: "bsm"` v1.0.0, private | Real Sanity Studio (sanity.config.js, schemaTypes/, static/) | `node_modules/` (578M) + npm `package-lock.json` |
| integrations | 4.0K | NO | Single `README.md` (placeholder) | none |
| onboarding | 4.0K | NO | Single `shop-onboarding.md` (doc) | none |
| preview | 260K | NO | 2 loose JS scripts (`extract-template.js`, `generate-preview.js`) + `output/*.html` + `templates/*.css` (tracys) | none |
| shops | 196K | NO | `tracys-collision-center/` content: profile.json + md briefs + content/ | none |

### studio package.json (the only real one)
```json
{
  "name": "bsm",            // → rename target: @psg/studio
  "private": true,
  "version": "1.0.0",
  "scripts": { "build": "sanity build", "deploy": "sanity deploy", "dev": "sanity dev", ... },
  "dependencies": { "sanity": "^5.20.0", "@sanity/vision": "^5.20.0", "react": "^19.2.4", "react-dom": "^19.2.4", "styled-components": "^6.1.18" },
  "devDependencies": { "@sanity/eslint-config-studio": "^6.0.0", "@types/react": "^19.2.14", "eslint": "^9.28", "prettier": "^3.5", "typescript": "^5.8" }
}
```
- Carries npm `package-lock.json` → must be removed inside pnpm workspace (let pnpm manage). Not covered by plan Task 2 pre-clean (only strips node_modules/.turbo/dist/.next/coverage).

---

## Cross-ref check (AC-1, AC-5 input)

- `apps/psg-hub/package.json` deps: **no reference** to studio / integrations / onboarding / preview / shops (by name, `bsm-*`, or relative path).
- `grep` across `apps/psg-hub/src`: **zero** imports of any sibling.
- **Conclusion: NO cross-refs.** Task 5 dep-rewrite is a no-op ("none found, no changes"). Relocating siblings will not break psg-hub imports.

## Dep-rewrite mapping (only applicable one)

| Original name | → Scoped name | Applies |
|---------------|---------------|---------|
| `bsm` (studio) | `@psg/studio` | YES (rename only; no hub ref to rewrite) |
| (none) integrations | `@psg/integrations` | N/A — no package.json |
| (none) onboarding | `@psg/onboarding` | N/A — no package.json |
| (none) preview | `@psg/preview` | N/A — no package.json |
| (none) shops | `@psg/shops` | N/A — no package.json |

---

## Hard consequences for the plan as-written

1. **AC-5 / success "6 workspace members" is unreachable.** pnpm only counts dirs that have a package.json. Best case post-plan: **2 members** (psg-hub + @psg/studio). Putting the 4 stubs in `packages/*` makes them silently-ignored non-members, not an error.
2. **AC-4 (jq rename `.name`) cannot run on the 4** — no `name` field exists. Scoping them = *creating* new package.json files = new content, which violates plan boundary "no code edits inside siblings beyond package.json name field." That is scope creep, not a rename.
3. **AC-6 residue list is incomplete.** Beyond `.paul/ + PLANNING.md + README.md + CLAUDE.md`, bsm root also holds out-of-scope items not in this plan's move list (flag, do not act): `docs/`, `supabase/`, `.paperclip/`, `paperclip.config.json`, `.env`, `CLAUDE.original.md`, `.git/`, `.gitignore`, `.DS_Store`.

---

## Decision (BLOCKING — operator's call)

**studio executes as-written** (relocate → `packages/studio`, scope `@psg/studio`, drop npm lock, pnpm install + typecheck). No ambiguity there.

**The only real decision is the 4 non-package stubs.** Crux: are they meant to *become* packages later (scaffold-now intent), or stay as content/docs (different home)?

| Option | studio | The 4 stubs | ACs impact |
|--------|--------|-------------|------------|
| **A (recommended)** | → `packages/studio`, `@psg/studio` | Defer to a later content/scaffold plan; leave at source for now | "6 members" → "2 members; 4 deferred" |
| **B** | → `packages/studio`, `@psg/studio` | Physically move all 4 → `packages/*` as non-member placeholders (no scoping) | "6 members" → "2 members + 4 non-member dirs"; AC-4 N/A for 4 |
| **C** | → `packages/studio`, `@psg/studio` | Move to a non-package home: `shops`+`preview`+`onboarding`+`integrations` → `content/` or `docs/` (they're content/scripts/docs) | "6 members" → "2 members; 4 relocated as content" |

Recommendation: **A** (or **C** if operator wants them out of `~/apps/projects/bsm/` now). Both respect the "no fabricated package.json" boundary. **B** clutters `packages/` with non-packages.
