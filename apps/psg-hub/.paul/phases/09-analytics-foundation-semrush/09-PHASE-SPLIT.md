# Phase 9 — Analytics foundation + SEMrush — plan split

**Goal:** Build the reusable analytics surface ONCE, proven end-to-end with the lowest-friction source (SEMrush, account-level, no per-shop OAuth). Foundation for phases 10 (Google Ads) / 11 (GA4+GSC) / 12 (PSG report).

**Mode (operator):** build-all autonomously, PAUSE once at the operator-gate batch. Everything builds + tests against a LOCAL Supabase (08-04b harness, zero prod). Gate batch (single pause at phase end): apply migration to prod · add prod SEMrush API key · deploy (+ resolve the `.vercel` link location — psg-hub is now its own repo).

**Grounding (2026-06-04, overturned ROADMAP premise):** no source has stored data; `google_ads_*` tables absent on prod; ads page is a coming-soon guard; no chart lib; no SEMrush code. Report template (`archive/local_reach-outputs`) is GONE — Phase-12 input to re-source; data model is jsonb-primary until then.

## Key decisions (plan-time)
- **Charts = Recharts-direct** (not Tremor — Tremor couples to Tailwind-3 config theming; psg-hub is Tailwind 4). Wrapped in PSG-token-styled primitives. Verify Recharts 3.x / React 19.2 peer deps at install.
- **Data model = source-agnostic** `analytics_snapshots` (source dim + `metrics jsonb` + idempotent unique key). Typed headline columns deferred to report-template re-sourcing.
- **No real-time** — cached snapshots, 6h sync cadence, last-synced timestamp surfaced (ads-dashboard canon).
- **Anti-slop pillars binding** (ads-dashboard ORIGINAL-PLANNING): story-led, token-first, every state designed (empty/loading/error/no-data), brand-token compliance.

## Plans
- **09-01** Analytics data model (migration, local-only) + Recharts + PSG-branded chart primitives. autonomous.
- **09-02** Analytics dashboard shell + MSO cross-shop aggregate + switcher search/typeahead + LCP<2s gate. autonomous.
- **09-03** SEMrush ingest (resilience + idempotent upsert, HTTP API contract) + organic-SEO panel wired into the shell; per-shop via `shops.url` (4/7 have one; 3 → no-data state). autonomous.

**Gate batch (end of phase, single pause):** prod migration apply · prod `SEMRUSH_API_KEY` · `.vercel` link resolution + `vercel --prod` · visual/brand human-verify.
