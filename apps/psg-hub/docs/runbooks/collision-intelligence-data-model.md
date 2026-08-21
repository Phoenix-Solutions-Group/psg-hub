# Collision intelligence data model

## Purpose

PSG collision intelligence combines privacy-safe repair history, insurer labels,
customer-market geography, official crash context, severe weather, and governed
weekly forecasts. It supports shop operations; it does not estimate individual
crashes or insurer claim volume.

Supabase project `gylkkzmcmbdftxieyabw` is the governed source of truth. The
dashboard reads only shop-scoped aggregates after the signed-in user's shop
membership is resolved.

## Data flow

```text
FileMaker repair export ──> collision_repair_sources / collision_repair_facts
                                      │
                                      ├──> insurer review
                                      ├──> governed address evidence ──> exact shop mapping
                                      └──> v_collision_repair_orders
                                                    │
NOAA/NCEI/SPC ──> storm sources/events/ZIP months ──┤
KDOT/NHTSA ─────> crash sources/facts ──────────────┤
                                                    ▼
                                  shop metrics, ZIP alerts, training frames
                                                    │
                           chronological evaluation + manual model approval
                                                    ▼
                                  collision_demand_forecasts + monitoring
```

## Governed objects

| Object                                     | Grain                               | Purpose and boundary                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collision_repair_sources`                 | One imported export                 | Provenance, hash, row reconciliation, source timestamps, accepted/rejected counts.                                                                                                                 |
| `collision_repair_facts`                   | One privacy-safe repair record      | Arrival/completion dates, repair value, payment category, insurer label, five-digit ZIP, vehicle make/model, and quality flags. No customer name, street, phone, email, VIN, or claim number.      |
| `collision_shop_mappings`                  | One source shop key                 | Audited mapping from a FileMaker location to one PSG Hub shop. Name similarity alone is insufficient.                                                                                              |
| `collision_shop_identity_evidence`         | One source shop key                 | Superadmin-reviewed physical address plus authoritative source. A database trigger requires an exact governed-to-Hub address match before mapping. Code previews cannot authorize a mapping.       |
| `collision_insurer_alias_reviews`          | One normalized source label         | Audited canonical reporting decision. Carrier-tagged repair volume remains repair volume, not claim volume.                                                                                        |
| `v_collision_repair_orders`                | One governed repair record          | Unified shop-scoped repair facts. A complete mapped FileMaker snapshot replaces legacy rows for that shop.                                                                                         |
| `v_collision_weekly_demand`                | Shop and week                       | Repair arrivals, insurance-paid mix, repair value, average repair amount, and observed cycle time.                                                                                                 |
| `v_collision_weather_monthly`              | Shop and month                      | Historical-repair-weighted NOAA exposure. Coverage is repair volume in ZIPs with loaded boundaries; no event row means zero observed events, not missing coverage. Exposure is not vehicle damage. |
| `v_collision_zip_alert_candidates`         | Shop, ZIP, and preliminary event    | Recent SPC hail, wind, or tornado signals in historical customer ZIPs. Signals require human review.                                                                                               |
| `collision_weather_alert_cases`            | Shop, ZIP, event type, and date     | Owner/manager acknowledgement, pre-registered prior-year control, immutable signal/control evidence snapshots, and written closure. No notification side effect.                                   |
| `v_collision_weather_alert_case_evidence`  | One weather review case             | Exact 1–4 week shop/ZIP repair arrivals and trailing 364-day baselines for the signal and its pre-registered control.                                                                              |
| `v_collision_weather_alert_monitoring`     | Shop and alert cohort               | Descriptive follow-through rates and percentage-point difference for closed evaluable matched pairs. It cannot authorize notifications or operational changes.                                     |
| `v_collision_ksdot_monthly`                | Shop and month                      | Official Kansas crash context across qualifying customer ZIPs.                                                                                                                                     |
| `nhtsa_crashes` / `nhtsa_dataset_sources`  | Fatal crash and source release      | National/state FARS context when local KDOT coverage does not apply. FARS is not total crashes.                                                                                                    |
| `collision_forecast_model_registry`        | Shop, week-one policy               | Evaluation evidence and manual approval for the first forecast horizon.                                                                                                                            |
| `collision_forecast_horizon_registry`      | Shop and horizons two through four  | Horizon-specific evaluation evidence and manual approval.                                                                                                                                          |
| `collision_forecast_candidate_evaluations` | Source shop, cutoff, and input hash | Reproducible service-only four-horizon evidence recorded before mapping. It cannot map a shop, approve a model, generate a forecast, or publish.                                                   |
| `collision_demand_forecasts`               | Shop, origin week, and horizon      | Governed prediction, interval, source age, publication status, reason, and eventual actual/error.                                                                                                  |
| `v_collision_forecast_monitoring`          | Shop and horizon                    | Rolling live MAE, WAPE, interval coverage, and review state. Monitoring never changes approval automatically.                                                                                      |

All public views in this vertical use `security_invoker = true`. Operational
tables have RLS enabled and are service-role only unless an explicitly reviewed
policy says otherwise. The service key stays server-side.

## Metric contracts

- **Repair orders:** count of governed repair facts by `arrival_date`.
- **Insurance-paid repairs:** count where `is_insured is true`. This is not the
  number of claims written by an insurer.
- **Repair value:** sum of `repair_amount_cents`; dollars are a presentation
  conversion only.
- **Average repair amount:** repair value divided by repair orders with a valid
  amount.
- **Cycle time:** `completion_date - arrival_date`, averaged only over rows with
  both dates; the observation count must accompany the average.
- **Customer market:** normalized five-digit customer ZIP. ZIP is retained for
  aggregation and exposure, not customer identification.
- **Weather exposure:** NOAA event counts and severity weighted by the shop's
  historical repair distribution across covered ZIPs.
- **Crash context:** official crash counts for qualifying geography and period;
  unavailable coverage must never render as zero.

## Freshness and publication gates

1. A FileMaker export must be reconciled and loaded; source snapshot age should
   be no more than 36 hours.
2. A superadmin must record authoritative physical-address evidence, and the
   database must match it to the exact PSG Hub shop before mapping can make repair
   history tenant-visible.
3. A model may be evaluated before mapping, but staging review requires the
   confirmed mapping.
4. Each horizon must beat that shop's 52-week seasonal MAE and achieve at least
   80% held-out-shop interval coverage before manual approval.
5. A forecast is publishable only when the approved model matches the scored
   model, the origin is the current Monday, and the latest repair arrival is no
   more than 14 days old.
6. Stale or insufficient inputs produce a stored blocked status and reason;
   they never produce a replacement guess.

The standard evaluation requires a seasonal lag plus 52 calibration weeks and
52 chronological holdout weeks. The initial coverage check therefore requires
at least 156 calendar weeks, after which the evaluator still excludes long
internal gaps. Promotion evidence must name a completed Monday cutoff; later,
potentially partial source weeks are excluded from every horizon.

The dashboard's historical baseline card uses that same minimum frame but is
exploratory only. Model approval depends on the separately stored, four-horizon
evaluation and interval-coverage evidence in the forecast registries.

## Forecast meaning

The target is aggregate weekly repair arrivals by shop for horizons one through
four. Supported candidate models are trailing-four-week demand and a blend of
recent demand with the same week one year earlier. The 52-week seasonal model is
the mandatory baseline.

Every displayed forecast must include:

- origin week and target week;
- point estimate and prediction interval;
- approved model key and horizon;
- latest source-arrival date and source age;
- publication status and plain-language reason;
- held-out MAE improvement and interval-coverage evidence; and
- the limitation that the output is repair demand, not crash or claim volume.

## Operating decisions

- **Staffing and scheduling:** review capacity only when the full forecast
  interval sits above the latest completed 13-week repair pace.
- **Marketing:** consider a demand-support action only when the full interval
  sits below the recent pace and booked work confirms the gap.
- **Parts and training:** use historical vehicle mix as a planning prompt, then
  validate against scheduled estimates before purchasing.
- **Insurance relationships:** use carrier-labeled repair mix for DRP/service
  planning, never as market claim share.
- **Weather response:** prioritize preliminary signals in ZIPs with meaningful
  historical repair volume, while treating the signal as exposure rather than
  confirmed damage.

## Operator sequence

1. Export the approved FileMaker field allowlist.
2. Import and reconcile source counts, hash, accepted rows, and rejected rows.
3. Review insurer aliases; preserve the raw label.
4. Record authoritative address evidence in Supabase. This does not map the shop.
5. Require an exact street/city/state/ZIP match and separately approve the shop
   mapping. Name similarity and code-only preview evidence are blocked.
6. Run the read-only four-horizon evaluator and record its input/evaluator hashes.
7. Stage passing evidence for superadmin review; staging does not approve.
8. In **Data Quality & Matching → Review forecast models**, inspect the complete
   four-horizon set, record substantive notes, and approve or reject it
   atomically. Approval registers model policy but does not score or publish.
9. Run the weekly scorer and confirm freshness/readiness before publication.
10. Monitor actuals, MAE, WAPE, and interval coverage; review drift manually.

## Current limitations

- PSG does not have complete insurer claim-volume data.
- Local crash coverage is source-specific; national FARS fallback is fatal-crash
  context only.
- Preliminary SPC reports can be revised and do not prove vehicle damage.
- Only exact, audited shop mappings can expose FileMaker history to a tenant.
- Forecasts cannot become operational when the mapped shop's latest arrivals
  are stale, even when the imported file itself is recent.

## Read-only readiness check

Probe the official KDOT ArcGIS source before opening a Supabase connection:

```bash
python3 scripts/import-ksdot-crashes.py --probe --start-year 2019
```

The probe requires no environment file and performs no database write. It reports
the exact row count for every requested year plus the latest source crash date.
Compare those values with `ksdot_crash_sources`; a difference means the public
source was revised and does not by itself prove that newer crash dates exist.

Run the KDOT importer only under separate production data-refresh approval. After
the import, require exact source/import count reconciliation, complete ZIP-resolution
status (matched or explicitly unmatched), refreshed monthly rollups, and an updated
source ledger before treating the crash feed as current.

```sql
select
  (select count(*) from public.collision_repair_facts) as repair_facts,
  (select count(distinct source_shop_key) from public.collision_repair_facts) as source_shops,
  (select max(arrival_date) from public.collision_repair_facts) as latest_repair_arrival,
  (select count(*) from public.collision_shop_mappings where mapping_status = 'mapped') as mapped_shops,
  (select count(*) from public.collision_demand_forecasts where status = 'published') as published_forecasts,
  (select count(*) from public.collision_demand_forecasts where status = 'stale_source') as stale_forecasts,
  (select max(month) from public.v_collision_weather_monthly) as latest_weather_month,
  (select count(*) from public.v_collision_zip_alert_candidates) as active_zip_alerts;
```

Run this query as a read-only diagnostic. Do not treat row counts or a preview
screen as proof that a source refresh, mapping, model approval, publication, or
notification occurred.
