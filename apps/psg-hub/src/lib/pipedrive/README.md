# Pipedrive deals mirror — durable read path (PSG-434)

**Owner:** Engineering (Ada → delegated). **Consumer:** Reese/CRO → John (PSG-432 §2.1 / Phase 3).

## Why

The accounting/sales overhaul needs a **pipeline-weighted revenue forecast**
(committed vs. best-case) and confirmation of the ~14% YoY revenue decline. Both
require **open-deal count + total open-pipeline-$**, broken down per S0–S8 stage and
weighted by stage win-probability. Today that number lives nowhere queryable —
only the Pipedrive *Organizations* master was one-time imported; **deals were not**.

## Architecture (durable path chosen over interim export)

```
Pipedrive REST API ──(cadenced sync, service role)──► public.pipedrive_deals ──► buildForecast() ──► report / API / export
        (deals)                                         public.pipedrive_sync_runs        (pure, tested)        (Reese → John)
```

- **Mirror table** `public.pipedrive_deals` (migration `20260630093900_pipedrive_deals_mirror.sql`):
  one row per deal, keyed by Pipedrive `deal_id` (UPSERT target). Stores value,
  currency, status, pipeline/stage, per-deal win probability, org/person, **owner**
  (sales rep), `expected_close_date` + **actual `close_date`**, `last_activity_date`
  (stale-flag driver), add/update times, and the raw payload. Default-deny RLS;
  reads gated on `view_sales_pipeline`; service-role
  ingestion bypasses RLS. A `pipedrive_sync_runs` log records cadence health/staleness.
- **Forecast core** (`forecast.ts`) — pure, dependency-free, fully unit-tested:
  `buildForecast(deals, { stageProbability, committedStageIds })` → three named
  confidence lines (low → high) plus the per-stage breakdown:
  `{ openDealCount, committedValue, committedWeightedValue, committedDealCount,
  weightedValue, bestCaseValue, perStage[] }`.
  - **committed** = Σ value of open deals at **≥ S6** (face floor) — the downside line.
  - **weighted/expected** = Σ(value × prob) over **all** open deals — the midpoint that
    feeds John's PSG-432 §2.1 forecast.
  - **best case** = Σ value over **all** open deals — the unweighted ceiling.
  The committed gate uses an explicit `committedStageIds` set once the live
  `stage_id → Sn` map is known; until then it falls back to resolved win-probability
  ≥ `COMMITTED_PROBABILITY_THRESHOLD` (S6 = 0.95). **The S0–S8 stage→probability map is
  owned by Reese/CRO (PSG-433).** When a stage isn't in the map it falls back to the
  deal's own Pipedrive `win_probability/100`, so the per-stage breakdown + totals are
  available even before the final weights are locked.

## What is built vs. TODO (delegated)

Built (this scaffold, committed): migration, `types.ts`, `forecast.ts` + tests, this doc.

TODO (engineer — see PSG-434 child issue):
1. **`client.ts`** — typed Pipedrive REST client. Auth via `PIPEDRIVE_API_TOKEN`
   (read-only token; provisioned by operator — see token child issue). Paginate
   `GET /api/v2/deals` over all open deals (and recently-updated won/lost for churn).
2. **`sync.ts`** — map API deals → `PipedriveDeal`, UPSERT into `pipedrive_deals`,
   write a `pipedrive_sync_runs` row. Idempotent; safe to re-run.
3. **Cadence** — invoke `sync.ts` on a schedule (Vercel cron route
   `/api/cron/pipedrive-sync`, or a Paperclip routine). Daily is sufficient for a forecast.
   Wire the canonical S0–S8 weights from `stages.ts` (`buildStageProbabilityMap`)
   once you have the Pipedrive `stage_id → Sn` mapping; "committed" = stages ≥ S6.
4. **Query/export surface** — expose `buildForecast` output: a server query helper +
   a CSV/JSON export. Reuse the `ops/reports` export conventions. Carry these fields
   per Reese's PSG-435 spec — all already present in `PipedriveDeal` + the mirror
   table (just map them, no schema change needed):
   - **Per open deal:** `dealId`, `title`, `value`, `stageId`/`stageName` (S0–S8),
     `status`, `expectedCloseDate`, `lastActivityDate` (for the stale flag),
     `ownerId`/`ownerName`.
   - **Rollups:** open-deal count + total open-pipeline-$ + per-stage breakdown.
5. **Open/closed mapping (Reese, PSG-435):** when the live stages are known, confirm
   which `stage_id`s carry Pipedrive `status=open`. S8 Won — and S7 Commercial once
   signed — must come back `status=won` so they are excluded from the forecast (they
   are realized revenue, not pipeline). If any S7/S8 deal returns `status=open` it
   would inflate the committed line — surface a warning row and flag it to Reese.
   **S7 still `status=open` = committed-not-booked** (don't classify as won).
6. **Stale-deal flag (Reese, PSG-435):** use the `lastActivityDate` column (now in the
   schema — last logged activity, distinct from `pipedrive_update_time`) and mark any
   open deal with no movement in **14 days** as stale, so stale pipeline is visible and
   discountable rather than silently summed into the forecast.
7. **Won/booked as a DISTINCT reconciled set (John's CFO guard, PSG-435):** export
   won/booked deals (S8, or S7 once signed) as a **separate** line — `orgName` +
   face `value` + `closeDate` + a summary total — kept apart from the open pipeline.
   They overlap the Invoiced recurring base (~67 subs · $75.2K MRR), so John reconciles
   them against Invoiced MRR before §2.1; summing them into the forecast would
   double-count. This is surfacing-only — **not** a `buildForecast` change (`buildForecast`
   already filters to `status === "open"`); it's an additional export section. QA on
   [PSG-447] asserts the won/booked set is present and disjoint from the open set.

## Refresh path (operational)

- **Automatic:** the scheduled sync UPSERTs the live deal set daily; `synced_at` and
  the latest `pipedrive_sync_runs` row show freshness. Stale (no OK run in 48h) → alert.
- **Manual:** run the sync entrypoint once (documented in the entrypoint header) to
  force a refresh; verify `select max(synced_at), count(*) from public.pipedrive_deals`.

## Secrets

`PIPEDRIVE_API_TOKEN` — **read-only** Pipedrive API token, set server-side only
(Vercel env, never client). Generated by the operator (Nick) per the
operator-task-protocol; agents cannot mint vendor dashboard tokens.
