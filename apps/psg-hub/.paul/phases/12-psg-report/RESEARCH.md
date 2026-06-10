# Phase 12 Research - PSG report (narrative + PDF)

Design and content canon: `/Users/schoolcraft_mbpro/dev/psg/clients/tracys` (specifically `tracys-ai-visibility-report.html` + `assets/design-system/colors_and_type.css` + bundled Gotham/Didact fonts). Target app: `/Users/schoolcraft_mbpro/dev/psg/internal/psg-hub/apps/psg-hub` (`psg-hub@0.2.0`, Next 16.2.3, React 19.2.4, TS strict).

## Summary

- The monthly recurring template is `tracys-ai-visibility-report.html` (CONFIRMED). Its structure is masthead → "story so far" KPI cards → per-source trend bars → before/after comparison table → trajectory projection → "what is driving the movement" takeaways → sources/method → footer. The other four canon files (`collision-market-review`, `recommendations`, `content-outlines`, `executive-summary`) are one-time onboarding/quarterly artifacts and are NOT monthly sections (CONFIRMED by reading the files; cadence read is the analyst's call, operator should ratify).
- The canon report is built on Peec AI (AI share of voice) and Local Falcon (Local SoLV, map rank, grid coverage), NEITHER of which is ingested (CONFIRMED). Of the four LIVE prod sources (`semrush`, `google_ads`, `ga4`, `gsc`), only SEMrush appears in the canon, and only in 3 rows. The canon also self-labels "Illustrative sample. Figures are for demonstration and are not actual measured client results" (CONFIRMED, footer). This is the load-bearing scope fork: ship live-data-only (reuse the stylesheet, build new GA4/GSC/Ads sections that have no canon precedent) OR gate Phase 12 on ingesting Peec AI + Local Falcon first. Operator must decide before a full plan.
- The daily-to-monthly rollup must classify every metric into FLOW (sum), STOCK (latest-in-month), or DERIVED-RATIO (recompute from summed components) (CONFIRMED via `types.ts` + the dashboard's aggregate-exclusion rationale). SEMrush `organic_traffic` is an estimated-monthly value re-snapshotted daily (CONFIRMED: `page.tsx:375` caption "Estimated monthly visits from organic search"); summing it across ~30 days overcounts (the "~30x" magnitude is inference, not sourced). No monthly-rollup helper exists today; `monthlyRollup`/`monthWindow`/`momDelta` are NEW.
- The report is per-shop (single shop), so the dashboard's cross-shop ratio exclusions DO NOT apply: `ctr`, `cpl`, `engagement_rate`, `authority_score`, `position` are valid and SHOULD appear (CONFIRMED). All four sync paths write `period:"daily"` only; the report derives monthly at report time and must NOT read `period:"monthly"` (CONFIRMED: `sync.ts:100`, `gsc-sync.ts:156`, `ga4-sync.ts:157`, `google_ads sync.ts:136`).
- PDF: render the existing branded HTML/CSS through headless Chromium `page.pdf()` (CONFIRMED correct engine; reuses the canon verbatim). But "reliably on Vercel Fluid Compute in 2026" is REFUTED (CONFIRMED refutation): Fluid Compute strips the AWS env var sparticuz relies on, causing a launch-time `libnss3.so`/`libnspr4.so` failure independent of workload weight. RESOLVED recommendation: render Chromium on a runtime you control (a Hetzner box Nick already operates, full `puppeteer`) called over HTTP; this eliminates the 250MB limit, pack-tar version pinning, and the Fluid env-var folklore.
- Multi-LLM: the architectural direction (Vercel AI Gateway + structured output + single-writer-plus-deterministic-verifier) is CONFIRMED, but the research's anchor API `generateObject` is REFUTED for AI SDK v6 (deprecated; CONFIRMED via the 5→6 migration guide). RESOLVED: write `generateText` + `Output.object({ schema })`, budget a spike for the `stopWhen` step config v6 requires. Reject best-of-N; the binding constraint is numeric fidelity, which deterministic TS code enforces at 100% and a judge does not.
- The eval gate is a cascade in the cron, BEFORE PDF render: Schema (Zod) → Numeric groundedness (+direction +attribution) → Brand-rule lint (em dash/emoji hard block) → optional LLM judge (CONFIRMED industry pattern). Stage B (numeric groundedness, allowed-number set built deterministically from `ReportData` before generation) is the load-bearing gate; threshold 100%, one fabricated client-facing number is a hard fail. Fail ladder: regenerate with violations fed back → deterministic template fallback (numbers injected, never generated) → hold for human. The cron never auto-emails an unverified report.
- Delivery: store the PDF in a private Supabase Storage bucket keyed `{shop_id}/{period}.pdf` (CONFIRMED reuses the existing `user_shop_ids()` RLS model; Vercel Blob's bearer model knows nothing about it and adds a net-new dep). Email a LINK not an attachment (current `MailMessage`/`buildPayload` cannot attach; multi-MB base64 hurts deliverability). Gate the download via a session + membership-checked route, never a raw signed URL. Monthly cron `0 0 1 * *` appended to `vercel.json`, CRON_SECRET-gated, idempotent on a NEW `monthly_reports` table.

## Template canon (`tracys-ai-visibility-report.html`)

Source of truth: five HTML reports + `assets/design-system/colors_and_type.css`, all loading that one stylesheet as the single token source, sharing one `psgnav`, one masthead pattern, one footer. Fonts are bundled locally as `.otf`/`.ttf` (`Gotham-*.otf`, `DidactGothic-Regular.ttf`) in `assets/design-system/fonts/` (CONFIRMED on disk).

### The monthly template structure

`tracys-ai-visibility-report.html` is cadence-based ("3-week progress"), fully data-driven over a canonical layout with illustrative sample numbers. Phase 12 reproduces the LAYOUT, not the figures:

- **Masthead** - eyebrow ("AI and local visibility, 3-week progress") + h1 + `.sub` lead + `.meta` (Window / Sources / Status) + `.backlink` CTA.
- **h2 "The story so far"** - 4 `.kpi` stat cards (value + `.chg up/down` delta + label) + a `.callout` interpretation.
- **h2 "Local reach, week by week"** - `.badge-src` source tag + CSS bar-fill `.trend-row` chart, one row per week + `.note-fine`.
- **h2 "AI answers, week by week"** - same trend-bar pattern, `.trend-fill.ai` midnight fill.
- **h2 "Three weeks ago vs this week"** - `table.psg`, columns Metric / prior / current / Change, classes `.now`/`.up`. Rows: AI SoV, Local SoLV, avg map rank, grid coverage, Authority Score, monthly organic visits, organic keywords ranked.
- **h2 "Where this is heading"** - projection `table.psg`: this week / 90d / 6mo / 12mo, `.tgt` target class.
- **h2 "What is driving the early movement"** - `.takeaways` bulleted narrative.
- **h2 "Sources and method"** - `.src` provenance.
- **Footer** - "Prepared by Phoenix Solutions Group · ... · {date}".

### Critical data-source mismatch (load-bearing)

The canon's above-the-fold identity is Peec AI + Local Falcon, neither ingested. Mapping canon rows to the four LIVE sources:

| Canon row / section | Canon source | In prod ingest? |
|---|---|---|
| AI answer Share of Voice; "AI answers, week by week" | Peec AI | NO |
| Local SoLV, avg map rank, grid coverage; "Local reach, week by week" | Local Falcon | NO |
| Authority Score, monthly organic visits, organic keywords ranked | SEMrush | YES (only overlap) |
| (no canon row) website traffic | GA4 | YES but no canon template |
| (no canon row) search clicks/impressions/CTR/position | GSC | YES but no canon template |
| (no canon row) paid spend/conversions/CPL | Google Ads | YES but no canon template |

A live-data-only report keeps 3 SEMrush rows and adds three GA4/GSC/Ads sections with no canon precedent. That is a different report wearing the canon's stylesheet, not a reproduction of it. This is the scope fork the operator must resolve (Open question 1).

### Visual design system (canon = `colors_and_type.css` tokens only)

Color tokens: `--psg-midnight #1E3A52` (Foundation Navy: masthead/footer/table headers), `--psg-ember #B8483E` (Phoenix Red: single accent moment, eyebrow rule, `.you` row, focal badge), `--psg-dark-ash #4B5058` (Iron, supporting copy), `--psg-paper #FAFAFA` (page bg), `--psg-bone #F0F0F0` (card bg), `--psg-stone #E0E0E0` (hairlines), `--psg-graphite #2A2A2A` (body ink). Semantic: success `#526B51`, warning `#C28E3A`, danger = ember. The market-review's inline `#c8102e`/`#14213d` palette is superseded by these tokens.

Fonts: display/headings `--font-display: "Gotham"` (eyebrows uppercase 0.18em tracking, ember); body `--font-body: "Didact Gothic"` (NOT Gotham for body), line-height 1.65; mono JetBrains Mono. Type scale 1.250 major third; reports cap at fs-36 (h1) / fs-24 (h2). Spacing 4pt grid. Radii restrained (6px cards, 4px chips). Container 1120px. Logo: `assets/design-system/logos/psg-logo-reverse.svg` in the dark nav.

How data is shown: PURE HTML/CSS, no SVG/canvas/charting library. KPI stat cards; `table.psg` with midnight headers and `font-variant-numeric: tabular-nums`; CSS bar-fill trend rows (`<div class="trend-fill" style="width:51%">20.4%</div>`); color-classed scores; `.chg.up` delta chips. Every report carries `@media print` rules (`break-inside:avoid`, `print-color-adjust:exact`). Implication: render the PDF as one branded HTML document via Chromium print-to-PDF, no chart library needed.

### Tone and voice

Plain, direct, declarative. Second person to the driver, third person about the client. Leads with a thesis sentence then evidence. Hedges only where data is uncertain ("verify", "likely", "illustrative"). House move: name the gap, then the lever. The no-em-dash rule is obeyed in all deliverable copy (CONFIRMED: ranges use "to" or hyphens; clause breaks use periods/semicolons/colons; the only em dashes are inside CSS code comments). The Phase 12 narrative generator must hold this exact standard. Verbatim samples:
- "The gains are small and early, which is exactly what healthy, durable momentum looks like at this stage."
- "A 1.8-point lift off zero is small in absolute terms and large in meaning."
- "Reputation is the strength here, not the gap to fix."

## Content model

The report is per-client (single shop). Cross-shop ratio exclusions do not apply; single-shop ratios are valid and SHOULD appear.

### Daily-to-monthly rollup rule per metric (the correctness core)

Data is stored daily; the report is monthly. The "summed ratio lies" warning the codebase documents for cross-SHOP also hits cross-TIME. Three rollup classes; getting this wrong makes the report factually false.

| Rollup class | Rule | Metrics |
|---|---|---|
| **FLOW / SUM** | Add daily values to a monthly total | GA4: `sessions`, `new_users`, `engaged_sessions`, `key_events`. GSC: `clicks`, `impressions`. Ads: `spend`, `clicks`, `impressions`, `conversions`, `cost_micros` |
| **STOCK / LATEST** (period-end, never sum) | Take latest-in-month value | ALL SEMrush: `organic_traffic`, `organic_traffic_cost` (estimated-monthly values, summing overcounts), `authority_score`, `organic_keywords`, `backlinks`, `position_distribution`. GA4 `total_users`/`active_users` are dedup uniques (summing overcounts; UNVERIFIED exact GA4 month-unique semantics, flag in narrative) |
| **DERIVED-RATIO** (recompute from summed FLOW components, never average daily ratios) | `ctr` = Σclicks/Σimpressions. `engagement_rate` = Σengaged/Σsessions. `cpl` = Σspend/Σconversions (null when Σconversions=0). `position` = impression-weighted avg of daily position (approximation; UNVERIFIED vs GSC's server-computed monthly avg; recommend impression-weighted to avoid a second API surface, flag in narrative) | |

MoM delta = `(thisMonthRollup - priorMonthRollup) / priorMonthRollup`, computed AFTER rolling each month by its class. NEW helpers: `monthlyRollup(rows, strategyMap)`, `monthWindow(year, month, now?)` (clock injectable, analogue of `trailingWindow`), `momDelta(current, prior): number|null` (null when prior null/0/absent).

### Section-to-metric mapping (live-data-only variant)

| Report section | Canon mirror | Source + exact metric keys | Class | Generation |
|---|---|---|---|---|
| **Masthead** | eyebrow + h1 + `.sub` + `.meta` + `.backlink` | Window = report month; Sources = distinct sources with rows; Status from `analytics_sync_runs` | auto frame + LLM lead | calendar month |
| **Executive summary** | "story so far": 4 `.kpi` cards + `.callout` | KPI cards: GA4 `sessions`, GSC `clicks`, Ads `conversions`, SEMrush `organic_keywords` (recommended headline set) | values+deltas auto; `.callout` = LLM (eval-gated) | each card by its class; `.chg` = MoM |
| **Search (GSC)** | trend-bar + comparison row | `clicks`, `impressions` (SUM); `ctr`, `position` (DERIVED) | auto | sums + recompute |
| **Website traffic (GA4)** | trend pattern | `sessions`, `key_events`, `engaged_sessions` (SUM); `engagement_rate` (DERIVED) | auto | sums + recompute |
| **Paid (Google Ads)** | trend pattern, gated to linked shops | `spend`, `clicks`, `conversions` (SUM); `cpl` (DERIVED, null on 0 conv) | auto | sums + recompute |
| **Organic authority (SEMrush)** | "vs this week" `table.psg` | `organic_traffic`, `organic_traffic_cost`, `authority_score`, `organic_keywords`, `backlinks`, `position_distribution` | auto | LATEST only, never sum |
| **MoM trends** | "three weeks ago vs this week" `table.psg` | prior-month vs current-month rollup for all above | auto math + optional LLM per-row "Change" | each metric by its class, both months rolled identically |
| **What is driving movement** | "what is driving the early movement" `.takeaways` | rolled metrics + deltas as input | LLM (eval-gated) | n/a |
| **Where this is heading** | projection `table.psg`, `.tgt` | current rollups as baseline | LLM rationale (eval-gated) + operator-set targets | baseline = current rollups |
| **Recommendations** | lighter `.rec` blocks | driven by metric gaps (low ctr, rising cpl, flat keywords) | LLM (eval-gated) + operator override | n/a |
| **Sources and method** | `.src` provenance | `analytics_sync_runs` (source, status, finished_at) + window dates | auto | n/a |
| **Footer** | "Prepared by PSG · {month} {year}" | generation date | auto | n/a |

### `ReportData` shape (single object → LLM + PDF)

```ts
export type MetricCell = {
  current: number | null;   // null = no data this month
  prior: number | null;     // null = source <2 months old / no prior data
  deltaPct: number | null;  // (current-prior)/prior; null if prior null/0
};
export type Trend = { d30: SeriesPoint[]; d90: SeriesPoint[] };

export type SemrushReport = { organicTraffic: MetricCell; organicKeywords: MetricCell;
  authorityScore: MetricCell; backlinks: MetricCell; trafficValueUsd: MetricCell;
  trends: { organicTraffic: Trend; organicKeywords: Trend } };          // all STOCK
export type GoogleAdsReport = { spend: MetricCell; clicks: MetricCell; impressions: MetricCell;
  conversions: MetricCell; cpl: MetricCell;                              // cpl RATIO, rest FLOW
  trends: { spend: Trend; conversions: Trend } };
export type Ga4Report = { sessions: MetricCell; totalUsers: MetricCell; newUsers: MetricCell;
  engagedSessions: MetricCell; keyEvents: MetricCell; engagementRate: MetricCell;  // engagementRate RATIO
  trends: { sessions: Trend; keyEvents: Trend } };
export type GscReport = { clicks: MetricCell; impressions: MetricCell;
  ctr: MetricCell; position: MetricCell;                                // ctr+position RATIO
  trends: { clicks: Trend; impressions: Trend } };

export type ReportData = {
  shopId: string; shopName: string; monthLabel: string;
  periodStart: string; periodEnd: string; generatedAt: string; lastSyncedAt: string | null;
  linkedSources: AnalyticsSource[];          // sources with a block this month
  sourcesWithPriorMonth: AnalyticsSource[];  // of those, which have a meaningful MoM
  semrush: SemrushReport | null; googleAds: GoogleAdsReport | null;
  ga4: Ga4Report | null; gsc: GscReport | null;
};
```

Read window: fetch a trailing 90 days of daily rows in ONE `getSnapshots` call per source (≥2 calendar months so MoM has a prior), then roll up in memory. Trends reuse `toSeries` directly off those daily rows.

### Two graceful-degradation dimensions

1. **Source not linked / no rows** - daily fetch returns `[]` ⇒ block is `null`, source absent from `linkedSources`. Mirror the dashboard's `rows.length === 0` empty-state (`page.tsx:402`). Narrative + PDF iterate `linkedSources` only.
2. **Linked but <2 months history** (the launch-day default; GA4+GSC merged in Phase 11, today 2026-06-10) - current present, prior empty ⇒ `prior:null`, `deltaPct:null`. Source in `linkedSources` but NOT `sourcesWithPriorMonth`. The LLM prompt receives `sourcesWithPriorMonth` so it reports current-state language and OMITS MoM claims rather than inventing a 0% or baseline. Cold-start fallback: the canon's "3-week progress" within-period framing until a clean prior month exists; the generator must detect missing-prior-month and switch framing rather than render a divide-by-zero.

## Multi-LLM narrative

Scheduled per-shop monthly narrative grounded in FIXED numbers. Current repo: raw `@anthropic-ai/sdk@^0.90.0` only; no `ai`/`@ai-sdk`/`zod` installed.

### Gateway + structured output (RESOLVED)

Route through Vercel AI Gateway with a plain `provider/model` string. The Gateway is GA (CONFIRMED since 2025-08-21, NOT April 2026; the April-2026 source is a usage snapshot) and stable for non-interactive jobs; its value (centralized auth, budget caps, observability, model fallback) lands on a monthly cron over many shops. Add `ai` (v6) + `zod`. Keep the existing `responder.ts` (Haiku, direct SDK) as-is; Phase 12 is a clean new module.

CONFIRMED-correct calls:
- Model routing: `model: 'anthropic/claude-opus-4.8'` bare string auto-routes through the Gateway (dot notation in the slug; raw Anthropic id is `claude-opus-4-8`). Verify live slugs at build time.
- Fallback: `providerOptions: { gateway: { models: ['anthropic/claude-sonnet-4.6'] } }` (CONFIRMED key, ordered try-in-order). Restrict fallbacks to same-family Claude so voice and the no-em-dash rule stay stable.

**REFUTED API correction (load-bearing):** do NOT use `generateObject` - it is deprecated in AI SDK v6 (CONFIRMED via the 5→6 migration guide: "generateObject and streamObject have been deprecated"). Write:
```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';
const { output } = await generateText({
  model: 'anthropic/claude-opus-4.8',
  output: Output.object({ schema: z.object({ /* one field per report section */ }) }),
  prompt,
});
```
This path runs inside the unified tool-call loop and requires `stopWhen` step config. Budget a small spike to confirm the exact `stopWhen` predicate against your installed v6 build before committing the module. Use `.describe()` on Zod fields to inject brand rules inline (v6 supports field-level instructions, e.g. `z.string().describe('No em dashes. No emojis. Active voice.')`).

### Shape: one writer + deterministic verifier (REJECT best-of-N)

For a narrative pinned to FIXED numbers the failure mode is fabricated/drifted numbers and brand-rule violations, not bland prose. Best-of-N multiplies cost K-fold and optimizes subjective taste that deterministic code enforces for free. Concrete shape per shop:
1. **Writer** - `generateText` + `Output.object`. Numbers supplied as a locked JSON block; the writer references metrics by placeholder (`{{traffic_mom_pct}}`), code substitutes the real formatted values post-generation (token substitution = the model cannot hallucinate a value it never types).
2. **Deterministic verifier** - pure TS: extract every numeral, assert membership in the allowed set; em-dash/emoji/banned-phrase regex. Free and 100% reliable on what it checks. Mirror the existing `checkResponseSafety()` precedent (`responder.ts`) with a `checkBrandStyle()`. Reuse the `humanizer`/`uncodixfy` rule lists.
3. **Optional LLM critic** (Haiku 4.5) - single point-wise gate, not a ranker. Skip for v1.

Writer model: default `anthropic/claude-sonnet-4.6` for routine sections, `anthropic/claude-opus-4.8` for the headline + recommendation sections only. Wrap LLM calls in the existing `withRetry`/`CircuitBreaker` (`resilience.ts:40,90`; not currently wired into `responder.ts`). Log via `logLLMCall` (`llm-call.ts:24`) with `reviewId:null, purpose:"monthly_report_narrative"`.

### Cost / latency

Fan out one invocation per shop at `export const maxDuration = 300` (Fluid default 300s all plans). Cache the static system+brand block across all shops in a run (90% off cached input). Use the Batch API (50% cheaper, async fits a scheduled job). Sonnet 4.6 writer + cached static prompt + Batch ⇒ well under $0.02/shop/month; 500 shops is roughly $10/month. Token magnitudes (~3k in / ~1k out) are UNVERIFIED until real prompt size is measured.

## Branded PDF

Engine (CONFIRMED): render the existing branded HTML/CSS through headless Chromium `page.pdf()`. This is the only path that reuses the canon's `@media print`, `@page`, `break-inside:avoid`, CSS custom properties, and bar-fill charts verbatim. `@react-pdf/renderer` (REJECT: no raw HTML/CSS, Flexbox-only, would rebuild the entire canon) and Satori (REJECT: single-canvas OG images, no multi-page pagination) both throw away the Phase-11 design-system investment.

**Runtime (RESOLVED, refutes "on Vercel Fluid Compute"):** "Chromium reliably renders a multi-page PDF inside a Vercel Function on Fluid Compute in 2026" is REFUTED. Fluid Compute disables the AWS-specific env var `@sparticuz/chromium` relies on to locate system libraries, producing a launch-time `libnss3.so`/`libnspr4.so` failure at `puppeteer.launch()` / `page.goto()`, before any rendering, independent of whether the workload is one PDF or a scraping loop (CONFIRMED via Vercel community thread + Sparticuz #254). The documented fix is non-obvious and fails silently: `AWS_LAMBDA_JS_RUNTIME` must be set in the dashboard, not in code; several guides say disable Fluid Compute entirely. Version pinning is exact and per-deploy (`@sparticuz/chromium` is at 149 / Chrome 149 as of June 2026, min Node 22.17; the research's `^133` is six majors stale; pack-tar URL must match the npm version exactly).

RESOLVED recommendation: **render Chromium on a runtime you control.** Run full `puppeteer` (bundled Chromium, no 250MB limit, no pack-tar pinning, no env-var folklore) on a small containerized worker. Nick already operates Hetzner boxes; that is the lowest-variance host. The Vercel app calls it over HTTP and streams back the PDF. This reuses 100% of the brand templates and eliminates every Fluid-Compute failure mode. Fallback option: a managed browser service (Browserless) via `puppeteer-core.connect()`. If forced to stay on Vercel: pin `chromium-min` to the current major with a matching pack-tar on Blob, set `AWS_LAMBDA_JS_RUNTIME` in the dashboard, disable Fluid Compute on the function, Node 22.x, and validate the deployed PDF, not `npm run dev`.

Fonts (CONFIRMED gotcha): serverless/containerized Chromium has no system fonts, and CSS `@font-face` only resolves over `http(s)://`. The canon uses relative `url("fonts/Gotham-*.otf")` paths. Serve the fonts over HTTPS (or base64-inline them in a print stylesheet) and load the report via `page.goto()` to an HTTP-served print route so relative URLs resolve against the origin. Validate the rendered PDF, never local dev (local has system fonts and masks the bug). Implementation: add a server-rendered `/reports/[slug]/print` HTML route emitting the branded markup + design-system CSS; `printBackground: true` honors the navy masthead; format `Letter`.

## Eval gate

Runs inside the generation cron as `evaluateReport(narrative, reportData) → { verdict, scores, violations }`, AFTER narrative generation, BEFORE PDF render. No PDF is rendered from an un-passed narrative. Defense-in-depth cascade, cheap-deterministic-first.

Client-facing-fatal failure modes to gate hardest: F1 hallucinated number, F2 wrong MoM direction, F3 cross-source attribution error, F5 brand-rule violation (em dash/emoji). F7 schema break is the cheap pre-gate.

- **Stage A - Schema (Zod, ms).** Re-validate the generated object; required sections present, non-empty. Catches F7. Fail ⇒ regenerate.
- **Stage B - Numeric groundedness (deterministic, ms; THE load-bearing gate).** Build the allowed-number set from `ReportData` BEFORE generation (raw metrics + precomputed deltas/percentages, plus formatted variants `1,240`/`1240`, `12%`/`0.12`). Extract every numeral from the prose; any with no match = F1 BLOCK. Direction sub-check (F2): compare the sign of the matched delta to the claimed direction word. Attribution sub-check (F3): key the allowed set by `(source, metric, period)`, so a GA4 number in a GSC sentence fails. Threshold 100%, not a percentage; one fabricated client-facing number is a hard fail.
- **Stage C - Brand lint (deterministic, ms).** Regex: em dash, emoji, "not just X but Y", banned filler, passive-voice heuristic. Em-dash/emoji = hard BLOCK (CONFIRMED non-negotiable PSG rules). Reuse `humanizer`/`uncodixfy` rule sets rather than re-deriving.
- **Stage D - LLM judge (one call, only if A-C pass).** Rubric scored 1-5 with written justification: accuracy/faithfulness, brand voice, no-em-dash backstop, actionability. Pass each ≥4/5. Use a different model family from the writer to reduce self-preference bias (natural fit for the multi-LLM router).

**Pass:** schema valid AND numeric groundedness 100% (zero unmatched numbers, zero direction/attribution mismatches) AND zero hard brand violations AND all judge dimensions ≥4. **Fail ladder:** regenerate (≤2 retries) with the specific violation quoted back → deterministic template fallback (numbers injected, never generated, so always truthful) → hold for human (never auto-email a degraded report).

Determinism/testability: commit ~15-30 frozen `ReportData` fixtures including planted-bad cases (hallucinated number, inverted direction, em dash, cross-source mis-attribution). Stages A-C are fully deterministic and asserted in CI unit tests with exact expected BLOCK reasons. Stage D is non-deterministic: pin model+version, temperature 0, assert direction (good ≥4, planted-bad <4) not exact score, run scheduled not per-PR, and calibrate the 4/5 threshold against a handful of human labels before trusting it as a gate.

## Delivery

- **Storage (RESOLVED: Supabase Storage, private bucket).** The decisive constraint is access control: the app already gates customer reads on the `user_shop_ids()` RLS model, and Supabase Storage enforces that same model natively. Vercel Blob's private mode is a separate bearer-token model that knows nothing about `user_shop_ids()`, so you would reimplement membership gating anyway plus add `@vercel/blob` + `BLOB_READ_WRITE_TOKEN`. Bucket: private `monthly-reports`, key `{shop_id}/{period}.pdf` (path carries the membership key), `upload(..., { upsert: true })` for idempotent re-runs. RLS: `SELECT USING ((storage.foldername(name))[1]::uuid IN (SELECT public.user_shop_ids()))`; writes service-role only.
- **Email (RESOLVED: link, not attachment).** `MailMessage`/`buildPayload` (`sendgrid.ts:61`) cannot attach (CONFIRMED: only maps to/from/subject/html/text/templateId/dynamicTemplateData). A multi-MB PDF base64-inflates ~30% toward the 30MB SendGrid cap and hurts deliverability. Send a SendGrid dynamic template with the report URL; the existing `sendEmail` already inherits retry + circuit breaker. The link points at the download route, not a raw signed URL.
- **Download route (RESOLVED: session + membership gate).** New customer route, `runtime="nodejs"`. Mirror the membership-gate pattern (`createClient()` SSR → `getUser()` → 401 if none → resolve the report's `shop_id`, run the explicit `shop_users` membership check → 403/404 if absent) → fetch the object with the service client → stream with `Content-Type: application/pdf`, `Cache-Control: private, no-store`. Re-auths and re-checks membership on every hit; the URL is un-shareable. If a direct CDN URL is ever needed, generate a short-TTL `createSignedUrl` inside this route AFTER the membership check, never in the cron/email.
- **Schedule (RESOLVED: monthly cron, idempotent).** Append `{ "path": "/api/cron/monthly-report", "schedule": "0 0 1 * *" }` to `vercel.json` `crons[]`. Clone the `CRON_SECRET` `timingSafeEqual` gate from `gsc-sync/route.ts` (run before any client). `runtime="nodejs"`. Iterate shops via the service client selecting shops with rows for the target month (skip shops missing sources, report skips in the JSON response). Idempotency needs a NEW table:
```sql
create table public.monthly_reports (
  shop_id uuid not null references public.shops(id),
  period_month text not null,            -- 'YYYY-MM'
  storage_path text not null,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (shop_id, period_month)
);
-- RLS: member SELECT (shop_id in (select public.user_shop_ids())); writes service-role.
```
Per-shop flow, all idempotent on `(shop_id, period_month)`: skip if a row exists → generate PDF → upload upsert → upsert `monthly_reports` row → send link email → stamp `emailed_at` only after `sendEmail` succeeds (a partial-failure re-run resends only un-emailed shops). Timeout/fan-out: a single cron iterating all shops while rendering multi-MB PDFs can exceed the function limit; set `maxDuration` high and batch a bounded number per invocation (resumable because step 1 skips done shops), or fan out per-shop jobs. State the per-run cap explicitly.

## Reuse vs new

### Reuse (verbatim or pattern)

| Need | Reuse | Citation |
|---|---|---|
| Per-shop snapshot read (RLS-clamped) | `getSnapshots` | `analytics/snapshots.ts:89` |
| MSO snapshot read | `getSnapshotsForShops` | `analytics/snapshots.ts:45` |
| Latest-in-window (STOCK reducer) | `latestSnapshot` | `analytics/aggregate.ts:41` |
| Trend series (0-fills non-numeric) | `toSeries` | `analytics/aggregate.ts:50` |
| Number/date formatting, last-synced | `formatNumber`/`formatShortDate`/`latestSyncedAt` | `analytics/aggregate.ts:87,76,108` |
| Exact metric keys per source | `Semrush/GoogleAds/Ga4/GscMetrics` | `analytics/types.ts:40,62,78,96` |
| LLM call shape (timeout, prompt cache, safety check) | `draftResponse` | `reviews/responder.ts:31` |
| LLM usage/result logging | `logLLMCall` | `logging/llm-call.ts:24` |
| Rate-limit-by-counting-log-rows | `assertWithinLimits` (variant by `purpose`+`shop_id`) | `reviews/rate-limit.ts:22` |
| Retry + circuit breaker | `withRetry`, `CircuitBreaker` | `resilience.ts:40,90` |
| Resilient email send (HTML body) | `sendEmail`/`MailMessage` | `mail/sendgrid.ts:155`, `mail/types.ts:6` |
| CRON_SECRET-gated route (GET+POST, nodejs) | clone `ga4-sync`/`gsc-sync` route | `api/cron/gsc-sync/route.ts:14` |
| Cron registration | append to `crons[]` | `vercel.json:9` |
| Customer download authz | membership gate | `draft-response/route.ts:28-71` |
| Role + shop-id resolution | `getDashboardAccess`/`decideDashboardAccess` | `auth/shop-access.ts:19,38` |
| Service-role / SSR clients | `createServiceClient` / `createClient` | `supabase/service.ts`, `supabase/server.ts` |
| Empty-state/linked inference | `rows.length === 0` | `dashboard/analytics/page.tsx:402` |

### New

| Need | Why | Decision |
|---|---|---|
| `ai` (v6) + `zod` | no AI SDK / Gateway dep; only raw Anthropic SDK | add; write `generateText`+`Output.object`, NOT `generateObject` |
| Multi-LLM via Gateway + same-family fallback | single provider/model only | new narrative module |
| Numeric/brand eval gate + judge | no judge/eval anywhere | new `evaluateReport` cascade |
| Wrap LLM calls in retry/breaker | `responder.ts` has bare timeout only | wrap with existing primitives |
| `monthlyRollup`/`monthWindow`/`momDelta` | `trailingWindow` is trailing-N-days only; no rollup-by-class | add to `aggregate.ts` or `report-data.ts` |
| `ReportData` type | no report payload type | new `report-data.ts` |
| HTML→PDF render | no PDF dep | full `puppeteer` on a controlled host (Hetzner), called over HTTP |
| `/reports/[slug]/print` HTML route | no render artifact exists | new branded print surface |
| Fonts over HTTPS | canon uses relative `url(...)` paths | serve `assets/.../fonts/*` over HTTPS or base64-inline |
| File storage | no blob/storage usage | private Supabase Storage bucket + RLS |
| Download route | none exists | new session+membership-gated route |
| Monthly cron route + entry | only daily syncs exist | new `/api/cron/monthly-report` + `vercel.json` entry |
| `monthly_reports` table | no report/artifacts table | new table + migration (idempotency key) |
| GA4/GSC/Ads section templates | canon has no precedent for these three | new branded sections (live-data-only path) |

## Open questions for /paul:plan

1. **Scope fork (go/no-go, operator-only).** (a) Ship live-data-only: SEMrush (3 rows) plus NEW GA4 + GSC + Ads sections with no canon template, abandoning the "AI and local visibility" narrative that is the canon's title and headline. OR (b) Gate Phase 12 on ingesting Peec AI + Local Falcon first so the report reproduces the canon it mirrors. These produce materially different plans (sections, ingestion scope, cron map, LLM inputs). RECOMMENDATION: ship (a) for the first release to deliver value on live data now, and queue Peec AI + Local Falcon ingestion as a follow-on milestone toward the full canon; confirm with operator.
2. **Projection target values** (`.tgt` column: 90d / 6mo / 12mo) - operator-set per shop, or omit the projection section in v1?
3. **Cadence confirmation** - ratify that `collision-market-review`, `recommendations`, `content-outlines`, `executive-summary` are intentionally NOT monthly sections (the files carry no cadence metadata).
4. **Cold-start framing default** - ratify falling back to the canon's "3-week progress" within-period framing when no clean prior month exists (most shops today, GA4+GSC merged Phase 11).
5. **PDF render host** - confirm the Hetzner-worker-over-HTTP path (RECOMMENDED) versus Browserless versus a hardened Vercel-with-Fluid-disabled function. This sets the deploy surface and a possible new service.
6. **Per-run shop cap / fan-out** - confirm actual shop count to size batching vs per-shop fan-out, and the Vercel plan `maxDuration` ceiling.
7. **Headline KPI set** - confirm the four `.kpi` cards (recommended: GA4 sessions, GSC clicks, Ads conversions, SEMrush organic keywords) versus an alternate set.
8. **Writer/judge model slugs** - verify live Gateway slugs for Opus 4.8 / Sonnet 4.6 and the `@ai-sdk/anthropic` prompt-cache option name at build time (consult `/claude-api`).

## Recommended phase shape

- **12-01 - Data pipeline + `ReportData`.** Add `monthlyRollup` (FLOW/STOCK/RATIO classifier), `monthWindow`, `momDelta` to the analytics layer; define `ReportData` + per-source report types; build the report-data assembler (90-day trailing fetch per source, roll current + prior month by class, populate `linkedSources`/`sourcesWithPriorMonth`, trends via `toSeries`). Unit tests on rollup correctness (especially SEMrush LATEST-not-SUM and the three derived ratios) and the two degradation dimensions. No LLM, no PDF; pure and fully testable.
- **12-02 - Multi-LLM narrative + eval gate.** Add `ai` (v6) + `zod`; build the writer module (`generateText` + `Output.object`, token-substitution grounding, same-family Gateway fallback, wrapped in retry/breaker, logged via `logLLMCall`); build `evaluateReport` (Schema → Numeric groundedness+direction+attribution → Brand lint → optional judge) with the regenerate → template-fallback → hold-for-human ladder. Commit the golden + planted-bad fixtures; assert Stages A-C in CI. Resolve the `stopWhen` spike here.
- **12-03 - Branded print route + PDF render + delivery.** Build `/reports/[slug]/print` (canon HTML/CSS + GA4/GSC/Ads sections, fonts over HTTPS); stand up the controlled-host Chromium render service (full `puppeteer`) returning a PDF over HTTP; store to the private Supabase bucket; add the `monthly_reports` table + migration; build the session+membership-gated download route; wire the link-email via the existing `sendEmail`.
- **12-04 - Monthly cron + operator activation.** New `/api/cron/monthly-report` (CRON_SECRET-gated, `runtime="nodejs"`, idempotent per `(shop_id, period_month)`, bounded batching/fan-out); append the `0 0 1 * *` entry to `vercel.json`; operator runbook for projection targets, the scope-fork decision, and a manual POST dry-run before the first scheduled run.
