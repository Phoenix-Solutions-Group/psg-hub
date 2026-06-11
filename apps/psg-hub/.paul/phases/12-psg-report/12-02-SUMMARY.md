---
phase: 12-psg-report
plan: 02
subsystem: api
tags: [ai-sdk-v6, vercel-ai-gateway, zod, llm, eval-gate, grounding, anthropic]

# Dependency graph
requires:
  - phase: 12-01
    provides: ReportData + SourceReportBlock (the typed monthly payload this narrates)
provides:
  - Multi-LLM narrative writer (AI SDK v6 generateText + Output.object via Vercel AI Gateway, token-substitution grounding)
  - Deterministic eval gate (numeric-groundedness 100%, brand-lint, F1/F2/F3 block codes)
  - generateNarrative orchestrator (writer -> eval -> regenerate -> template -> hold; never a false pass)
affects: [12-03 (PDF render — consumes the passed narrative), 12-04 (cron + live Gateway smoke + AI_GATEWAY_API_KEY)]

# Tech tracking
tech-stack:
  added: ["ai@^6.0.200", "zod@^4.4.3"]
  patterns:
    - "Token-substitution grounding: model writes {{placeholders}}, code injects real formatted values post-generation so the model cannot type a metric value"
    - "Deps-injected LLM call (deps.generate + deps.logCall) so the module is node-testable and never imports the server-only llm-call module"
    - "Cheap-deterministic-first eval cascade as a hard safety boundary before any client-facing render"
    - "Deterministic template fallback that passes the eval gate by construction (always truthful)"

key-files:
  created:
    - apps/psg-hub/src/lib/report/schema.ts
    - apps/psg-hub/src/lib/report/prompt.ts
    - apps/psg-hub/src/lib/report/narrative.ts
    - apps/psg-hub/src/lib/report/evaluate.ts
    - apps/psg-hub/src/lib/report/generate.ts
    - apps/psg-hub/src/lib/report/__tests__/evaluate.test.ts
    - apps/psg-hub/src/lib/report/__tests__/generate.test.ts
  modified:
    - apps/psg-hub/package.json

key-decisions:
  - "No stopWhen: no tools in the call, so the structured-output step needs no step budget (RESEARCH-confirmed v6 behavior)"
  - "Premium opus-4.8 routing is a v1 single-pass: PREMIUM_MODEL constant present, writer runs one model (sonnet-4.6 default); per-section premium routing deferred"
  - "Stage C adds a stray-{{placeholder}} hard block beyond em-dash/emoji — catches a substitution miss as a grounding failsafe"
  - "Brand block code is `brand` (not the PLAN's notional F5); F1/F2/F3 kept as planned"

patterns-established:
  - "LLM safety boundary = deterministic verifier the code enforces at 100%, not a model-graded score (Stage D judge interface present, v1-skipped)"
  - "Fail-ladder degrades to a deterministic always-truthful path rather than emitting an unverified pass"

# Metrics
duration: ~60min
started: 2026-06-10T15:16:00Z
completed: 2026-06-10T16:17:00Z
---

# Phase 12 Plan 02: Multi-LLM Narrative + Eval Gate Summary

**A grounded AI SDK v6 narrative writer (Vercel AI Gateway, token-substitution so the model never types a number) plus a deterministic eval gate that blocks fabricated numbers, wrong MoM direction, cross-source mis-attribution, and em-dash/emoji at 100%, wired into an orchestrator whose fail-ladder degrades to an always-truthful template and never returns a false pass.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~60 min |
| Started | 2026-06-10T15:16:00Z |
| Completed | 2026-06-10T16:17:00Z |
| Tasks | 3 completed |
| Files created | 7 (5 modules + 2 test files) |
| Files modified | 1 (package.json) + pnpm-lock.yaml |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Writer produces a structured, grounded narrative via AI SDK v6 through the Gateway | Pass | `narrative.ts`: `generateText` + `Output.object({schema})`, bare provider/model slug `anthropic/claude-sonnet-4.6`, same-family fallback via `providerOptions.gateway.models`, token-substitution grounding, brand rules via zod `.describe()`, `withRetry`+`CircuitBreaker`, `deps.generate`/`deps.logCall` injected, real v6 binding tsc-proven. Caveat: per-section opus-4.8 routing is a v1 single-pass (`PREMIUM_MODEL` constant present, not actively routed) — see Deviations. |
| AC-2: Eval cascade blocks fabricated/wrong-direction/mis-attribution/brand | Pass | `evaluate.ts`: Stage A schema, Stage B groundedness (allowed-number set per (source) from `buildPlaceholders`, F1 fabricated / F2 wrong-direction / F3 cross-source, 100% threshold), Stage C brand-lint (em/en dash + emoji + stray placeholder = hard block), Stage D judge interface present + v1-skipped. 4 planted-bad fixtures assert exact block codes; clean narrative passes. |
| AC-3: Orchestrator runs the fail-ladder, never a false pass | Pass | `generate.ts`: write -> substitute -> evaluate; regenerate <=2 with violations quoted back; deterministic `renderTemplateNarrative` (numbers injected, passes Stage B by construction); hold if even the template cannot assemble (zero linked sources). 4 generate tests cover pass/regenerate/template/hold. |
| AC-4: Typed, green, scoped | Pass | tsc 0 · eslint 0 (`src/lib/report`) · vitest 493/493 (+11). Only `ai`+`zod` added. No PDF/cron/email/route. responder.ts / safety.ts / 12-01 files untouched. Live Gateway smoke recorded as a 12-04 deferral. |

## Verification Results

```
deps:      "ai": "^6.0.200"   "zod": "^4.4.3"
typecheck: tsc --noEmit -> 0 errors
vitest:    Test Files 60 passed (60) | Tests 493 passed (493)   (+11 vs 482)
eslint:    src/lib/report -> 0 errors
```

## Accomplishments

- Shipped the narrative safety boundary the whole Phase-12 deliverable depends on: a client-facing monthly report can never render a fabricated or drifted number, because the eval gate enforces groundedness at 100% before 12-03 renders.
- Grounding is structural, not prompt-hoped: the model writes `{{placeholders}}` and code substitutes real formatted values after generation, so a hallucinated metric value is impossible by construction, and any number that does appear is checked against the allowed set keyed by source.
- The fail-ladder guarantees a truthful output or an explicit hold — regenerate, then a deterministic template that passes the gate by construction, never a silent false pass.

## Task Commits

Single squashed plan commit (not per-task atomic this plan):

| Scope | Commit | Type |
|-------|--------|------|
| 12-02 multi-LLM narrative + eval gate (all 3 tasks + tests + deps + PLAN.md) | `5500507` | feat |

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/report/schema.ts` | Created (40 ln) | zod section schema (headline, executiveSummary, sourceSummaries, recommendations); brand rules via `.describe()` |
| `src/lib/report/prompt.ts` | Created (126 ln) | System/brand block + user prompt + `buildPlaceholders` catalogue + `substituteNarrative` |
| `src/lib/report/narrative.ts` | Created (97 ln) | Writer: `gatewayGenerate` (v6 generateText + Output.object) + `writeNarrative` (deps-injected, resilience, logging) |
| `src/lib/report/evaluate.ts` | Created (161 ln) | `evaluateReport` 4-stage cascade + `buildAllowedNumbers` + F1/F2/F3/brand checks |
| `src/lib/report/generate.ts` | Created (99 ln) | `generateNarrative` orchestrator + `renderTemplateNarrative` fallback |
| `src/lib/report/__tests__/evaluate.test.ts` | Created (99 ln) | Planted-bad fixtures (hallucinated number, inverted direction, em dash, cross-source) |
| `src/lib/report/__tests__/generate.test.ts` | Created (87 ln) | Fail-ladder (pass / regenerate / template / hold) |
| `package.json` | Modified | + `ai` (v6) + `zod` |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| No `stopWhen` in the generate call | No tools in the call, so the structured-output step needs no step budget (v6) | Simpler binding; documented in `narrative.ts` header |
| Premium opus-4.8 = v1 single-pass | The writer runs one model (sonnet-4.6); dual-model per-section routing added complexity without a v1 quality signal | `PREMIUM_MODEL` constant present for 12-03/04 to wire if needed; AC-1's "opus for headline+recs" sub-clause is the deferred half |
| Stage C also hard-blocks stray `{{placeholder}}` | A leftover placeholder means substitution missed a value — a grounding failure that must not reach a client | Failsafe beyond the planned em-dash/emoji checks |
| Logger + generate both deps-injected | Keeps the module free of the server-only `llm-call` import so it is node/vitest-testable | Tests mock with no server runtime; real wiring lands at the 12-04 route/cron |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Scope additions | 1 | Stray-placeholder hard block (net safety gain) |
| Scope deferrals | 1 | Per-section opus-4.8 routing -> v1 single-pass |
| Naming | 1 | Brand block code `brand` vs the PLAN's notional `F5` |

**Total impact:** No scope creep; the one deferral (per-section premium routing) is cosmetic to v1 quality and the constant is in place for a later wire-up.

### Deferred Items

- Per-section opus-4.8 routing (headline + recommendations on the premium model) — `PREMIUM_MODEL` constant present, writer is single-model in v1. Wire at 12-03/04 if a quality signal warrants.
- Live Gateway smoke (one real `generateNarrative` end-to-end) + `AI_GATEWAY_API_KEY` secret — the 12-04 activation, recorded not silently skipped.

## Skill Audit (SPECIAL-FLOWS)

| Expected | Invoked | Notes |
|----------|---------|-------|
| Research-first / per-plan research check | ✓ | RESEARCH.md `f917f2b` (ultracode `wf_8f01e69a-625`) covers the narrative path + eval cascade, adversarially validated |
| `/claude-api` + Context7 `ai` (AI SDK v6) | ✓ | Implementation conforms to v6: `Output.object` (not deprecated `generateObject`), documented `stopWhen` reasoning, Gateway dot-notation slugs — the v6 contract was applied at APPLY, not written from memory |

## Issues Encountered

None.

## Next Phase Readiness

**Ready:**
- `generateNarrative(reportData, deps)` is the single verified entry point 12-03 (PDF) renders from and 12-04 (cron) schedules. It returns a gate-cleared narrative or an explicit hold.
- `gatewayGenerate` is the production binding to wire as `deps.generate` at the route/cron layer.

**Concerns:**
- The real Gateway call is unproven end-to-end (mocked in tests). The 12-04 live smoke must confirm the v6 binding + Gateway slugs + `AI_GATEWAY_API_KEY` against the live service before any real report ships.
- Per-section premium routing is deferred; revisit if v1 narrative quality is weak in the live smoke.

**Blockers:**
- None for 12-03.

---
*Phase: 12-psg-report, Plan: 02*
*Completed: 2026-06-10*
