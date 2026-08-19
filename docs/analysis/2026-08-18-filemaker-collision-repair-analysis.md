# FileMaker Collision Repair Analysis

**Supabase project:** `gylkkzmcmbdftxieyabw`
**Verified:** 2026-08-18
**Source:** Complete `repair-customer_nick.csv` snapshot, modified 2026-07-14 UTC

## Executive result

The governed repair layer now contains 327,313 PII-minimized repair facts from 199
usable FileMaker master shop keys. It supports shop, insurer, ZIP, vehicle,
seasonality, payment-mix, repair-value, cycle-time, and data-quality analysis.

The data can describe repair orders associated with an insurer label. It cannot be
called insurer claim volume because PSG does not have the carrier's complete claims
denominator. It can forecast a participating shop only after that source shop is
explicitly mapped and its repair arrivals are current.

## Reconciliation and privacy

| Check                               |                        Result |
| ----------------------------------- | ----------------------------: |
| Parsed source rows                  |                       327,314 |
| Accepted facts                      |                       327,313 |
| Rejected rows                       |     1 missing master shop key |
| Distinct accepted records           |                       327,313 |
| Source shop keys                    |                           199 |
| Source shops mapped to PSG Hub      |                             1 |
| Arrival range                       | 2011-01-18 through 2026-07-10 |
| 2026 arrivals                       |                        16,009 |
| Recorded repair value               |             $1,652,295,954.68 |
| Rows with at least one quality flag |                         7,365 |

Customer and agent names, street addresses, emails, phones, birthdates, raw
repair-order numbers, raw serials, and the raw source payload are not stored. The
source record key is a SHA-256 digest. The new snapshot stays invisible while loading
and becomes current only after its accepted count reconciles in one final transaction.

## Payment and insurance analysis

| Classification | Repair orders | Interpretation                                           |
| -------------- | ------------: | -------------------------------------------------------- |
| Insurance      |       262,127 | Known insurance payment category                         |
| Customer       |        61,302 | Known customer-pay category                              |
| Third party    |         2,699 | Known third-party payment                                |
| Non-insurance  |            11 | Explicit non-insurance value                             |
| Fleet          |            36 | Fleet payment                                            |
| Warranty       |             2 | Warranty payment                                         |
| Other          |            14 | Total-loss variants; insurance status intentionally null |
| Unknown        |         1,122 | Missing or unrecognized category; never guessed          |

The leading normalized insurer labels across the complete export are:

| Insurer label         | Repair orders |    Repair value |
| --------------------- | ------------: | --------------: |
| State Farm            |        66,579 | $345,958,883.00 |
| Progressive Insurance |        29,809 | $161,552,416.44 |
| GEICO                 |        22,391 | $123,164,672.54 |
| Allstate              |        17,665 |  $94,904,380.33 |
| U S A A               |        15,784 |  $85,849,829.64 |

These are repairs tagged with those labels, not counts of all claims filed with those
insurers. The service-only alias queue contains every observed normalized label;
similar variants remain separate until a reviewer explicitly approves a canonical
key and display name.

## Geographic and vehicle analysis

The highest raw repair-order ZIP counts are 98391 (3,130), 55044 (2,671), 96789
(2,637), 72758 (2,506), and 47240 (2,465). These counts are useful for customer-market
concentration, weather exposure, and shop-specific marketing. They are not population-
or vehicle-normalized market-share estimates.

The leading normalized make/model combinations are:

| Vehicle      | Repair orders |   Repair value |
| ------------ | ------------: | -------------: |
| Toyota RAV4  |         8,492 | $39,973,269.68 |
| Honda CR-V   |         7,917 | $33,927,573.54 |
| Toyota Camry |         6,846 | $28,335,681.18 |
| Ford F-150   |         6,508 | $37,235,307.57 |
| Honda Civic  |         5,623 | $23,158,213.24 |

Vehicle mix can guide OEM certification, aluminum/EV capability, parts capacity, and
technician training. It does not by itself measure repair complexity; parts, labor,
calibration, and damage-severity data would be needed for that claim.

## Data-quality watchlist

| Quality flag                                   |  Rows |
| ---------------------------------------------- | ----: |
| Missing repair-order number                    | 5,453 |
| Unknown payment category                       | 1,122 |
| Zero repair amount                             |   670 |
| Insurer label on known non-insurance repair    |   177 |
| Missing insurer on insurance-classified repair |   150 |
| Completion before arrival                      |   124 |
| Missing customer ZIP                           |    31 |
| Invalid vehicle year                           |    30 |
| Invalid arrival date                           |    19 |
| Invalid completion date                        |     5 |

Invalid optional values are nulled and flagged rather than guessed. The 124 negative
cycle observations do not contribute a completion date or cycle-time metric.

## Operational shop mapping

PS177 (`Shelton Collision Repair`) is explicitly mapped to the existing Collision
Leaders of Derby company and shop. The unified dashboard source contains exactly
3,420 FileMaker repairs and zero legacy pilot rows for that company, so it does not
double count the two sources. Its latest arrival remains 2025-12-24, which keeps the
weekly forecast in `stale_source` state with no numeric prediction.

The other 198 source shop keys remain unmapped and service-only. A source must not be
mapped from name similarity alone; each mapping needs an approved PSG Hub shop ID.
Company attribution is optional because the shop is the PSG Hub tenant boundary.

## Analysis views

| View                                             | Primary question                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `v_collision_filemaker_shop_summary`             | Which source shops are largest, freshest, and cleanest?                  |
| `v_collision_filemaker_shop_monthly`             | How are workload, value, insurance mix, and cycle time changing?         |
| `v_collision_filemaker_insurers`                 | Which carrier labels drive repair volume and value?                      |
| `v_collision_filemaker_zip_summary`              | Which customer ZIPs drive volume and weather exposure?                   |
| `v_collision_filemaker_vehicle_summary`          | Which makes and models drive work and value?                             |
| `v_collision_filemaker_seasonality`              | How do monthly patterns differ by shop and year?                         |
| `v_collision_filemaker_payment_mix`              | How does payment mix affect volume and value?                            |
| `v_collision_filemaker_quality_summary`          | Which source issues need correction first?                               |
| `v_collision_filemaker_weekly_demand`            | How does zero-filled weekly demand vary by source shop?                  |
| `v_collision_filemaker_forecast_training_weekly` | Which simple model beats seasonal demand on chronological shop holdouts? |

Example shop-month trend query:

```sql
select month, repair_orders, insured_repair_orders,
       repair_value_cents, average_repair_amount, average_cycle_days
from public.v_collision_filemaker_shop_monthly
where source_shop_key = 'PS177'
order by month;
```

Example insurer concentration query:

```sql
select insurance_company_name, repair_orders, repair_value_cents
from public.v_collision_filemaker_insurers
where source_shop_key = 'PS177'
order by repair_orders desc
limit 10;
```

Use the pre-aggregated views for dashboards. Filter by `shop_id` after resolving the
authenticated user's active-shop membership; do not query the service-only facts from
the browser.

## Next decisions

1. Automate a current recurring FileMaker snapshot so participating shops can pass
   the 14-day forecast freshness gate.
2. Approve source-shop mappings one at a time and verify that each mapping replaces,
   rather than unions with, any legacy source for that PSG Hub shop.
3. Review and approve the highest-volume candidates in the insurer-alias queue; never
   infer a canonical carrier from spelling similarity alone.
4. Track weekly forecast MAE, WAPE, interval coverage, and drift only after real
   published forecasts and actuals accrue.
5. Keep severe-weather alerts review-only until ownership, acknowledgement, and
   false-positive thresholds are approved.
