# Collision Intelligence Metric Contract

**Project:** PSG collision-repair intelligence
**Database:** Supabase `gylkkzmcmbdftxieyabw`
**Verified:** 2026-08-19

## Purpose

Provide a governed, PII-minimized analysis layer for repair demand, insurance mix,
customer-market crash and weather exposure, and weekly forecasting. The model
predicts repair arrivals. It does not claim to predict individual crashes or
insurance claim volume.

## Governed views

| View                                             | Grain                                           | Intended use                                           |
| ------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------ |
| `v_collision_repair_orders`                      | One repair order                                | De-identified drill-down and metric source             |
| `v_collision_weekly_demand`                      | Company and Monday-start week                   | Dashboard trends and observed weekly demand            |
| `v_collision_weather_monthly`                    | Company and month                               | Historical-repair-weighted NOAA exposure               |
| `v_collision_ksdot_monthly`                      | Company and month                               | Official KDOT crashes in the customer-ZIP portfolio    |
| `v_collision_forecast_training_weekly`           | Company and continuous week                     | Leakage-safe baseline and forecast training frame      |
| `v_collision_zip_alert_candidates`               | Company, ZIP, and preliminary event             | Review-only SPC signals from the last 72 hours         |
| `v_collision_filemaker_shop_summary`             | FileMaker source shop                           | Coverage, freshness, repair value, and quality summary |
| `v_collision_filemaker_shop_monthly`             | FileMaker source shop and month                 | Repair volume, value, insurance mix, and cycle time    |
| `v_collision_filemaker_insurers`                 | FileMaker source shop and normalized insurer    | Carrier-tagged repair volume and value                 |
| `v_collision_filemaker_zip_summary`              | FileMaker source shop and customer ZIP          | Customer-market volume and value                       |
| `v_collision_filemaker_vehicle_summary`          | FileMaker source shop and normalized make/model | Vehicle mix and repair value                           |
| `v_collision_filemaker_seasonality`              | FileMaker source shop, year, and month          | Seasonal volume, value, insurance, and cycle time      |
| `v_collision_filemaker_payment_mix`              | FileMaker source shop and payment class         | Payment mix, repair volume, and value                  |
| `v_collision_filemaker_quality_summary`          | FileMaker source shop and quality issue         | Affected-row counts and rates                          |
| `v_collision_filemaker_weekly_demand`            | FileMaker source shop and continuous week       | Privacy-safe multi-shop weekly evaluation frame        |
| `v_collision_filemaker_forecast_training_weekly` | FileMaker source shop and continuous week       | Per-shop lags and leakage-safe multi-shop holdouts     |
| `v_collision_forecast_monitoring`                | Shop and forecast horizon                       | Rolling live error and interval-coverage scorecard     |
| `v_collision_insurer_alias_candidates`           | Source shop and normalized carrier label        | Human review queue for canonical insurer aliases       |

All collision views use `security_invoker=true` and are service-role-only. `shop_id`
is the operational tenant and forecast key; optional `company_id` preserves legacy
attribution without requiring a synthetic company record for every FileMaker shop.
They expose
no customer or agent name, street address, phone, email, birthdate, raw repair-order
number, raw source serial, or repair-customer identifier. Customer ZIP is the finest
customer geography exposed. Every dashboard query is filtered by a shop resolved from
the authenticated user's membership before the service client is called.

## Metric definitions

### Repair and insurance

| Metric                       | Definition                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repair order                 | One unique source record. FileMaker identity is a SHA-256 digest of source system, master shop key, serial, and repair-order number; none of those raw identifiers are stored in the fact table |
| Source priority              | A complete, loaded, explicitly mapped FileMaker snapshot replaces legacy pilot rows for the same PSG Hub shop; the sources are never unioned for that shop                                      |
| Insured repair order         | A known insurance payment category, including customer insurance, claimant insurance, and insurer-pay/party-unknown variants                                                                    |
| Non-insured repair order     | Known customer, third-party, non-insurance, fleet, or warranty payment category                                                                                                                 |
| Unknown payment repair order | Any unrecognized or missing payment type; never silently counted as insured                                                                                                                     |
| Repair value                 | `repair_amount_cents`; dollars are derived only for display                                                                                                                                     |
| Average repair amount        | Sum of repair value divided by repair-order count at the requested grain                                                                                                                        |
| Cycle time                   | Calendar days from `date_in` through `date_out`; negative values fail quality review                                                                                                            |
| Weekly demand                | Repair orders grouped into PostgreSQL Monday-start weeks                                                                                                                                        |

The recent operating trend compares the latest 13 completed source weeks with the
preceding 13. It excludes the newest potentially partial source week, treats missing
weeks as zero demand and value, reports insurance-paid arrivals under the same window,
and weights cycle time by completed-cycle observations.

Dashboard seasonality averages each calendar month across the latest five complete
interior source years. The first and latest source years are excluded as potentially
partial, and a year must contain all 12 monthly rows to enter the comparison.

FileMaker carrier labels are available as trimmed raw labels plus lowercase
alphanumeric-normalized labels. They support carrier-tagged repair volume and value,
not insurer claim counts. `collision_insurer_alias_reviews` starts each observed
normalized label as a candidate. `v_collision_filemaker_insurers` merges variants
only after an explicit approved canonical key/name and reviewer are recorded.

### Weather

| Metric                  | Definition                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Customer ZIP portfolio  | Historical repair-order count by company and valid five-digit customer ZIP                                |
| Weather coverage        | Percent of portfolio repair orders represented by ZIPs with a NOAA monthly row                            |
| Weighted storm exposure | Sum of ZIP weather metric multiplied by historical repair count, divided by total historical repair count |
| Weather freshness       | Latest `storm_zip_monthly.refreshed_at` contributing to the company-month row                             |

Weather exposure is an operational signal, not a claim count. Forecast features use
the prior completed month so that training does not learn from future weather totals.

### Severe-weather alert candidates

| Metric             | Definition                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Candidate window   | NOAA SPC preliminary tornado, hail, and thunderstorm-wind reports from the last 72 hours               |
| ZIP match          | Event point covered by a stored ZIP polygon and present in the company's repair-customer ZIP portfolio |
| High signal        | Any tornado report, hail at least 1 inch, or wind at least 58 mph                                      |
| Review signal      | A preliminary report below or without a measured NWS severe threshold                                  |
| Notification state | Disabled; the dashboard is a review queue, not an automated alert sender                               |

SPC reports are preliminary and may be revised. A candidate indicates weather in a
historical customer market; it is not evidence of a damaged vehicle, repair order, or
insurance claim.

The local deployment configuration runs `/api/cron/collision-intelligence` daily at
12:15 UTC. Each run replaces three complete convective-day snapshots atomically, then
runs the weekly scorer. It also checks `v_collision_repair_feed_status`; any mapped
feed older than 36 hours is logged and makes cron health fail while weather refresh
and stale-gated scoring still run. Vercel deployment is a separate approval gate; the
schedule is not considered active until the production cron is deployed and
smoke-tested.

### Kansas crash context

| Metric                  | Definition                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| KDOT crash              | One `ACCIDENT_KEY` from the official KDOT statewide Accidents service              |
| ZIP match               | Crash coordinate covered by a stored ZIP polygon; unmatched points remain explicit |
| Portfolio crash count   | Sum of KDOT crashes in the company's distinct historical customer ZIPs             |
| Weighted crash exposure | ZIP crash count weighted by the company's historical repair orders in that ZIP     |
| Rain/snow crash         | KDOT `RAIN_WET_ROAD_ACCS` or `SNOW_ICE_ACCS` flag is positive                      |

KDOT report images, reporting agencies, driver ages, and free-text narratives are
not imported. The current partial month is excluded from the dashboard trend.

### Forecast frame

The forecast frame zero-fills missing weeks between the first and latest observed
repair week. It includes:

- one-, four-, and 52-week repair-order lags;
- the trailing four-week average excluding the current week;
- ISO year and ISO week;
- prior-month weighted hail, wind, tornado, and storm-demand exposure;
- prior-month weather coverage.

Evaluation must use chronological holdouts. Random train/test splits are prohibited
because they leak future operating conditions into historical predictions.
Until FileMaker supplies explicit source-coverage intervals, evaluation excludes all
history before the latest internal run of more than 26 zero-repair weeks. This keeps a
multi-year source gap from becoming synthetic evidence of zero shop demand. A shop
must still have enough post-gap history for calibration and holdout before promotion.

### Operational forecast publication

`collision_forecast_model_registry` is the shop-keyed week-1 model-promotion gate.
`collision_forecast_horizon_registry` independently gates weeks 2–4. An approved
model must beat its shop's registered seasonal MAE. `collision_demand_forecasts`
stores forecast origin, target week, horizon, selected model, empirical 80% interval
policy, source age, publication status, later actual volume, and absolute error. The
scorer:

- predicts up to four Monday-start weeks from one shared origin and information
  cutoff;
- reads only an approved model and interval from the registry;
- widens the shop-calibrated interval using a separately validated cross-shop policy;
- uses conservative PS177 intervals of ±9, ±8, ±7, and ±8 repairs for horizons 1–4;
- publishes only when the latest repair arrival is no more than 14 days old;
- writes a null prediction with `stale_source` or `insufficient_history` otherwise;
- backfills actual volume and absolute error after a published forecast week closes.

The dashboard must never turn a non-published forecast row into a numeric prediction.

`v_collision_forecast_monitoring` uses the latest 13 observed forecasts per shop and
horizon. It remains `awaiting_actuals` before 13 observations. After that, it requests
manual review when rolling MAE no longer beats the registered seasonal baseline or
80% interval coverage falls below 70%. Monitoring never changes model approval by
itself.

## Verified snapshots

### Full privacy-safe FileMaker export

| Check                                |                        Result |
| ------------------------------------ | ----------------------------: |
| Parsed source rows                   |                       330,535 |
| Accepted repair facts                |                       330,533 |
| Rejected rows                        | 2: missing shop key; invalid repair amount |
| Distinct accepted source records     |                       330,533 |
| Source shop keys                     |                           199 |
| Explicitly mapped source shop keys   |                             1 |
| Insurance-classified repairs         |                       264,625 |
| Known non-insurance repairs          |                        64,760 |
| Unknown/other payment classification |                         1,148 |
| Repair value                         |             $1,671,343,984.99 |
| Arrival range                        | 2011-01-18 through 2026-08-14 |
| 2026 repair arrivals                 |                        19,229 |
| Rows with one or more quality flags  |                         7,467 |

The source ledger reconciles `330,535 = 330,533 + 2` before the snapshot becomes
visible. Loading rows are hidden from analysis views; finalization and replacement of
the prior loaded snapshot occur in one database transaction.

### Mapped operational pilot

| Check                                     |                                                   Result |
| ----------------------------------------- | -------------------------------------------------------: |
| Repair orders                             |                                                    3,420 |
| Distinct repair-order IDs                 |                                                    3,420 |
| FileMaker rows                            |                                                    3,420 |
| Legacy pilot rows                         |                                                        0 |
| Insurance-paid orders                     |                                                    3,062 |
| Known non-insurance orders                |                                                      358 |
| Unknown payment types                     |                                                        0 |
| Distinct source insurer labels            |                                                      129 |
| Repair value                              |                                           $16,133,812.40 |
| Average cycle time                        |                                                14.8 days |
| Arrival range                             |                            2019-11-18 through 2025-12-24 |
| Valid customer ZIPs                       |                                                      143 |
| Customer ZIPs with any weather history    |                                                      135 |
| Companies with repair history             |                                                        1 |
| Continuous weekly modeling rows           |                                                      319 |
| Rows with a 52-week lag                   |                                                      267 |
| Multi-shop weekly modeling rows           |                                                   35,850 |
| Multi-shop eligible holdout shops         |                                                       79 |
| Current-shop holdout shops                |                    44; trailing-4 beat seasonal in 40 |
| Current-shop interval validation          | 81.5% coverage on 22 held-out shops after 1.10× widening |
| KDOT crash facts, 2019 through 2026-08-13 |                                                  411,208 |
| KDOT ZIP-matched crash facts              |                                         410,910 (99.93%) |
| KDOT unmatched crash facts                |                                                      298 |
| KDOT ZIP-month rows                       |                                                   45,048 |
| Pilot customer-portfolio crash months     |                                                       92 |
| Current SPC preliminary event facts       |                                                   25,999 |
| Latest SPC preliminary event              |                                     2026-08-19 16:22 UTC |
| Current weekly scoring state              |            `stale_source`; no numeric forecast published |

## Quality gates

Before dashboard publication or model retraining:

1. `(source_export_id, source_record_hash)` remains unique and source-ledger counts reconcile before finalization.
2. Arrival and completion dates parse as ISO dates.
3. Completion is not earlier than arrival.
4. Repair value is present and non-negative.
5. Unknown payment categories are reported separately.
6. Weather coverage and freshness appear alongside weather-derived metrics.
7. Each forecast report states its training window, holdout window, error metrics,
   company coverage, and whether it beat the registered seasonal baseline.
8. Models trained on one shop are labeled shop-specific and are not represented as
   fleet-wide PSG forecasts.
9. KDOT source-year counts reconcile before a sync is marked loaded.
10. ZIP matching reports matched, unmatched, and pending records separately.
11. Event-level weather remains labeled preliminary, uses the 72-hour window, and
    cannot trigger an external notification until an owner and lifecycle are approved.
12. Forecast publication is blocked when repair arrivals are more than 14 days old;
    blocked rows contain no predicted, lower, or upper value.
13. The scorer requires an approved model-registry row whose recorded MAE beats the
    seasonal baseline; model selection and interval policy remain auditable.
14. Planning guidance names its evidence and never converts a stale forecast,
    historical vehicle or insurer mix, or preliminary weather signal into an
    automatic staffing, purchasing, marketing, damage, or claim decision.
15. Forecast monitoring is horizon-specific, waits for 13 observed forecasts, and
    can request manual review but cannot auto-retire or auto-promote a model.
16. Evaluation excludes pre-gap history after an internal run longer than 26
    zero-repair weeks and reports insufficient post-gap history instead of calibrating
    a zero-width interval.

## Known limitations

- The full export has 199 usable source shop keys, but only PS177 is explicitly mapped
  to a PSG Hub company. Unmapped shops remain service-only and cannot appear in a
  participating shop dashboard.
- The alias review queue contains observed carrier-label candidates, but no canonical
  aliases are approved yet. Until review, the dashboard identifies them as unreviewed
  labels and does not merge variants.
- The mapped pilot's repair history ends in December 2025 while portfolio repair and
  weather data extend into August 2026.
- Gap-aware multi-shop evaluation covers 79 eligible historical shops and 44 current
  shops, but the current-shop interval estimate has only 22 held-out validation shops. Continue
  reporting the sample and observed coverage rather than treating it as guaranteed.
- Event-level SPC reports support same-day review but remain preliminary and
  point-based. The daily schedule is configured locally but is not a confirmed damage
  or claim feed and is not production-active until deployment is separately approved.
- KDOT is a submitted police-report source, not real-time, and the current year is
  partial. Official NHTSA systems remain national safety context, not local repair
  demand counts.
- Legacy accident partitions cannot be used in commercial outputs until provenance
  and licensing are proven.
