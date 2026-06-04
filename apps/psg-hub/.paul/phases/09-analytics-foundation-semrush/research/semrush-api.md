# Research: SEMrush HTTP API contract (verified live)

**Agent:** general-purpose (web + live API via SEMrush MCP) · **Date:** 2026-06-04

## Auth + base URLs
- Auth: `?key=YOUR_API_KEY` query param. `database=us` for US.
- TWO base paths:
  - Overview/organic: `https://api.semrush.com/?type=...`
  - Backlinks: `https://api.semrush.com/analytics/v1/?type=backlinks_overview`

## Metric → report → column (all verified live)
| Metric | Report (`type=`) | Column code | Notes |
|---|---|---|---|
| Organic keywords | `domain_rank` | `Or` | |
| Organic traffic (monthly est. visits) | `domain_rank` | `Ot` | |
| Organic traffic cost (USD) | `domain_rank` | `Oc` | |
| Backlinks total | `backlinks_overview` | `total` | |
| **Authority Score (0-100)** | `backlinks_overview` | **`score`** | NOT `ascore` (docs lie) |
| Position distribution | `domain_organic` → bucket `Po` client-side | `Po` | cost outlier |

`domain_rank` available columns: `Db,Dn,Rk,Or,Ot,Oc,Ad,At,Ac,Sh,Sv`. Authority Score is NOT in `domain_rank` — only `backlinks_overview` exposes it.

## Two bug-traps (verified live)
1. **Authority Score column = `score`, NOT `ascore`.** Several doc pages show `ascore`; tested live → API silently ignores the bad code and returns the default set, no error. Returned value `47` for the test domain under `score`.
2. **Any typo'd `export_columns` code silently falls back** to the full default set. → ALWAYS parse by the returned header line, never by requested column order.

## Response format
- Plain **CSV, semicolon-separated** (`;`). No JSON option.
- Header row is **human text** (`Organic Keywords`, not `Or`) → map by position in the returned header, or request known `export_columns` and parse by the returned header order.

## Errors
- Plain-text line, often with **HTTP 200**. Sniff for a leading `ERROR` token.
- `ERROR 50 :: NOTHING FOUND` (unknown domain, verified), `ERROR 120 :: WRONG KEY`, `ERROR 131 :: LIMIT EXCEEDED`.

## Cost + ingest shape
- 5 of 6 metrics in **2 cheap calls/domain**: `domain_rank` (~10 units) + `backlinks_overview` (40 units) = ~50 units.
- Position distribution is the cost outlier: `domain_organic` bills **10 units per keyword row**, no native bucket report. Cap with `display_limit=1000&display_sort=tr_desc`, bucket `Po` (top3 / 4-10 / 11-20 / 21-100) client-side — treat as a top-keywords sample.
- Rate limit ~10 req/sec. Prepaid API-units quota model; `display_limit` is the spend lever.

## Domain normalization
- Shop URL → API target: strip scheme + `www.` + path → bare root domain (e.g. `https://www.tracysbodyshop.com/contact` → `tracysbodyshop.com`).
- 4 of 7 shops have `shops.url`; 3 → no SEMrush call, render no-data state.

## Phase-9 application (09-03)
- Build a server-side `src/lib/semrush/client.ts` against this HTTP contract (NOT the MCP shape). Resilience (retry + circuit breaker via `src/lib/resilience.ts`); parse CSV by returned header; ERROR-token sniff before parse.
- Per-shop monthly snapshot: 2 calls (`domain_rank` + `backlinks_overview`) + 1 capped `domain_organic` for position buckets → 1 `analytics_snapshots` row (`source='semrush'`, `period='monthly'`, `metrics` = SemrushMetrics).
- `metrics` shape already typed in `src/lib/analytics/types.ts` (SemrushMetrics) — matches: organic_keywords/organic_traffic/organic_traffic_cost/backlinks/authority_score/position_distribution.
- `SEMRUSH_API_KEY` = operator gate (prod env); build/local-test against MCP-discovered shapes + fixtures.
