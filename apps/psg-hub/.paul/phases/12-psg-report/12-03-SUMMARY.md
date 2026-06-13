---
phase: 12-psg-report
plan: 03
subsystem: api
tags: [puppeteer, supabase-storage, pdf, chromium, rls, sendgrid, next-route-handler]

requires:
  - phase: 12-01
    provides: ReportData + assembleReportData + monthly rollup (types.ts, report-data.ts, rollup.ts)
  - phase: 12-02
    provides: ReportNarrative schema + token-substitution grounding (schema.ts, prompt.ts, narrative.ts, evaluate.ts)
provides:
  - Branded pure HTML renderer (render.ts) over ReportData + ReportNarrative
  - RENDER_TOKEN-gated internal print route /reports/[slug]/print
  - Controlled-host Chromium render client (render-client.ts) + in-repo Hetzner worker (workers/report-renderer/)
  - Private Supabase Storage persistence (storage.ts) + monthly_reports migration (authored)
  - Session+membership-gated download route + pure link-email builder (email.ts)
affects: [12-04 cron + operator gate batch]

tech-stack:
  added: [puppeteer (WORKER package.json ONLY — app gains no dep)]
  patterns:
    - "Self-contained print HTML with root-relative /fonts @font-face (not next/font) for worker-resolvable fonts"
    - "Controlled-host render: app HTTP-drives a Hetzner Chromium worker (Vercel Fluid refuted)"
    - "Private bucket + member-SELECT RLS via user_shop_ids(); service-role writes; download route re-auths every hit (no signed URL)"
    - "Build-local + deps-injected + migration-authored-not-applied (Phases 9/10/11 precedent)"

key-files:
  created:
    - src/lib/report/render.ts
    - src/app/reports/[slug]/print/route.ts
    - src/lib/report/render-client.ts
    - src/lib/report/storage.ts
    - src/lib/report/email.ts
    - src/app/api/reports/[shopId]/[period]/download/route.ts
    - workers/report-renderer/{render.mjs,Dockerfile,package.json,README.md}
    - supabase/migrations/20260610000000_monthly_reports.sql
    - public/fonts/*.otf,*.ttf
  modified: []

key-decisions:
  - "Fonts: root-relative /fonts @font-face replaces planned next/font (next/font cannot inject CSS in a raw-string route handler)"
  - "what-is-driving-movement takeaways sourced from narrative.sourceSummaries (schema has no takeaways field)"
  - "buildReportEmail gained a period arg to produce AC-3's monthLabel"
  - "Added print-route.test.ts beyond the planned file list to cover AC-1's 401 boundary"

patterns-established:
  - "Render is deterministic over the persisted eval-passed narrative (no LLM at render time)"
  - "Every visible numeral traces to ReportData/narrative; absent sources omitted; cold-start framed within-period"

duration: ~25min (APPLY)
started: 2026-06-11T09:40:00Z
completed: 2026-06-11T10:00:00Z
---

# Phase 12 Plan 03: Branded Print + Render + Storage + Delivery Summary

**The report ARTIFACT vertical: a token-gated branded print route, a controlled-host Chromium render client, private Supabase Storage, a membership-gated customer download, and a pure link-email builder — every local half of the delivery pipeline, ZERO prod contact, app dependency-flat.**

## Performance

| Metric | Value |
|--------|-------|
| Duration | ~25 min (APPLY) |
| Started | 2026-06-11T09:40:00Z |
| Completed | 2026-06-11T10:00:00Z |
| Tasks | 3 completed |
| Files created | 17 (8 src/route + 4 worker + 1 migration + 5 font files + 6 tests) |

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Token-gated branded print route renders from ReportData + narrative | Pass | render.ts emits canon layout (masthead → 4 KPI cards + executive-summary callout → per-source trend+table sections → MoM table → drivers → recommendations → sources/method → footer). Grounded numerals (body-numeral test), cold-start within-period framing, absent sources omitted. 401 (no/wrong/unconfigured token) + 400 (bad slug) covered by print-route.test.ts. Fonts via root-relative /fonts @font-face (see deviation 1). |
| AC-2: Render pipeline produces + persists PDF; worker authored; migration authored-not-applied | Pass | render-client.ts POSTs print URL to REPORT_RENDER_URL with RENDER_TOKEN bearer (withRetry+CircuitBreaker, deps.httpPost injected); storage.ts upserts PDF + narrative JSON to private bucket monthly-reports at {shop}/{period}.{pdf,json}; workers/report-renderer/ full-puppeteer worker (POST {url} → application/pdf, printBackground, Letter, awaits document.fonts.ready) with its OWN package.json; migration AUTHORED not applied. |
| AC-3: Membership-gated download; pure link-email built (not sent) | Pass | download route clones draft-response gate (getUser→401 / shop_users check→403 / service download→stream application/pdf, Cache-Control private no-store, 404 if missing); buildReportEmail returns templateId link-email with reportUrl in dynamicTemplateData, no send. Tests assert 401/403/200/404 + MailMessage shape. |
| AC-4: Typed, green, scoped | Pass | tsc 0 · eslint 0 errors · vitest 523 (493 prior + 30 new). App adds NO dep (puppeteer only in worker pkg). 12-01/12-02/responder/safety/daily-syncs/vercel.json untouched (git diff confirmed). |

## Verification Results

```
pnpm typecheck      → tsc --noEmit, 0 errors
pnpm lint           → 0 errors (4 pre-existing warnings, none in 12-03 files)
pnpm test           → 66 files, 523 tests passed
  new: render(7) · print-route(6) · render-client(5) · storage(5) · download(5) · email(3)
grep -L puppeteer package.json → app package.json has NO puppeteer
git diff scope      → 12-01/12-02/vercel.json/responder/safety/daily-syncs NONE touched
```

## Accomplishments

- Branded deterministic renderer that reuses the canon HTML/CSS verbatim (design tokens inlined from packages/ui/psg-brand/colors_and_type.css; @media print / @page Letter / break-inside preserved), grounded numeral-by-numeral.
- Controlled-host render path complete: app-side client (resilience-wrapped, injectable transport) + in-repo version-pinned Hetzner worker authored, deploy gated to 12-04.
- Private-bucket persistence + member-SELECT RLS + a session/membership-gated download that never exposes a raw signed URL.
- Pure link-email builder ready for the 12-04 cron to fire.

## Files Created/Modified

| File | Change | Purpose |
|------|--------|---------|
| `src/lib/report/render.ts` | Created | Pure ReportData+narrative → branded canon HTML |
| `src/app/reports/[slug]/print/route.ts` | Created | RENDER_TOKEN-gated internal print surface |
| `src/lib/report/render-client.ts` | Created | Drives controlled-host Chromium worker over HTTP |
| `src/lib/report/storage.ts` | Created | Private-bucket PDF + narrative persistence |
| `src/lib/report/email.ts` | Created | Pure link-email MailMessage builder |
| `src/app/api/reports/[shopId]/[period]/download/route.ts` | Created | Session+membership-gated PDF stream |
| `workers/report-renderer/render.mjs` | Created | Hetzner puppeteer worker (deploy=12-04) |
| `workers/report-renderer/Dockerfile` | Created | puppeteer base image container |
| `workers/report-renderer/package.json` | Created | Worker-only deps (puppeteer) |
| `workers/report-renderer/README.md` | Created | Contract + 12-04 deploy steps |
| `supabase/migrations/20260610000000_monthly_reports.sql` | Created | monthly_reports table + member-SELECT RLS + bucket RLS (AUTHORED, not applied) |
| `public/fonts/{Gotham-Book,Gotham-Medium,Gotham-Bold,Gotham-Black}.otf, DidactGothic-Regular.ttf` | Created | Brand faces served at /fonts for worker resolution (deviation 1) |
| `src/lib/report/__tests__/{render,render-client,storage,download,email,print-route}.test.ts` | Created | 31 unit tests |

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Root-relative /fonts @font-face instead of next/font | next/font only injects @font-face when its className renders in a React tree; a route handler returning a raw string never hits that pipeline, so fonts silently fall back. Root-relative /fonts/* resolves against the origin so the worker's page.goto embeds them. | Print route does NOT import fonts.ts; public/fonts/* added; worker awaits document.fonts.ready. Unit-testable (asserts /fonts refs present, no path-relative trap). |
| Takeaways ← narrative.sourceSummaries | 12-02 schema has no takeaways field; sourceSummaries (one paragraph per linked source) is the natural narrative home for "what is driving movement". | Per-source sections carry data viz (trend+table); narrative prose consolidates into the drivers list. Every narrative field used exactly once. |
| buildReportEmail(shop, period, downloadUrl, deps) | AC-3's dynamicTemplateData requires monthLabel, which needs the period; locked 3-arg signature had no source for it. | Honors AC-3's data contract exactly; one extra param. |

## Deviations from Plan

### Summary

| Type | Count | Impact |
|------|-------|--------|
| Auto-fixed (spec correction) | 1 | Essential — font mechanism could not satisfy its own AC-1 clause |
| Scope additions | 2 | public/fonts/* (font assets); print-route.test.ts (AC-1 401 coverage) |
| Mapping clarifications | 2 | takeaways→sourceSummaries; email period arg |
| Deferred | 0 | — |

**Total impact:** Corrections in service of the ACs; no scope creep beyond the plan's stated goal.

### Auto-fixed Issues

**1. [Spec] next/font cannot self-serve fonts in a raw-string route handler**
- **Found during:** Task 1 (render.ts / print route), surfaced via advisor before writing.
- **Issue:** Plan prescribed next/font self-serving via the print route. next/font injects @font-face only through Next's React/CSS pipeline; a route handler returning a raw HTML string bypasses it, so the brand faces are never served and the PDF silently falls back to system fonts. Worse: all unit tests pass while this is broken (font wiring is not observable in a string-equality test).
- **Fix:** render.ts inlines @font-face with root-relative `/fonts/*` URLs; the 5 used faces copied to public/fonts/; print route drops the fonts.ts import; worker awaits `document.fonts.ready` before page.pdf() (networkidle0 does not guarantee faces are applied).
- **Files:** render.ts, print route, public/fonts/*, workers/report-renderer/render.mjs.
- **Verification:** render.test.ts asserts `url("/fonts/Gotham-Book.otf")` present and no path-relative `url("fonts/` survives.

### Deferred Items

None.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Bash cwd drifted to repo root mid-session (turbo intercepted lint/vitest) | Re-ran gates with explicit `cd apps/psg-hub`; all green |
| Initial test typing (noUncheckedIndexedAccess, vi.fn arg inference, mock ref vs default) | Typed httpPost as RenderHttpPost, `!` on mock.calls index, returned actual handle fn refs |

## Skill Audit

All required skills invoked: Research-first ✓ (RESEARCH.md f917f2b) · Context7 puppeteer + Supabase Storage ✓ (page.pdf signature, waitUntil, storage RLS SQL confirmed at APPLY) · Next 16 route docs ✓ (read node_modules/next@16.2.3 route-handlers + dynamic-routes + runtime before writing routes).

## Next Phase Readiness

**Ready:**
- Full local delivery pipeline; 12-04 cron only schedules generate→render→store→email and the operator activates.

**Concerns:**
- Migration `((storage.foldername(name))[1])::uuid` cast throws on a non-uuid first path segment rather than returning false. Safe here (service-role writes only ever produce `{shop_id}/...` keys) but confirm at 12-04 apply against the real DB.
- 12-03 changes are NOT yet committed (prior plans committed per-plan: 12-01 a487b33, 12-02 5500507).

**Blockers:** None.

**12-04 GATE BATCH (recorded, not run):** apply 20260610000000_monthly_reports.sql · create private monthly-reports bucket + storage RLS · deploy Hetzner worker · set REPORT_RENDER_URL / RENDER_TOKEN / REPORT_EMAIL_TEMPLATE_ID · provision the SendGrid dynamic template · one live render smoke (generate→render→store→download end-to-end).

---
*Phase: 12-psg-report, Plan: 03*
*Completed: 2026-06-11*
