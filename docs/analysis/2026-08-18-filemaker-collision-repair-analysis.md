# FileMaker Collision Repair Analysis

**Supabase project:** `gylkkzmcmbdftxieyabw`
**Verified:** 2026-08-19
**Source:** Governed FileMaker OData export `filemaker_rc_5cba1235612af4c11a4e`

## Executive result

The governed repair layer now contains 330,533 PII-minimized repair facts from 199
usable FileMaker master shop keys. It supports shop, insurer, ZIP, vehicle,
seasonality, payment-mix, repair-value, cycle-time, and data-quality analysis.

The data can describe repair orders associated with an insurer label. It cannot be
called insurer claim volume because PSG does not have the carrier's complete claims
denominator. It can forecast a participating shop only after that source shop is
explicitly mapped and its repair arrivals are current.

## Reconciliation and privacy

| Check                               |                        Result |
| ----------------------------------- | ----------------------------: |
| Parsed source rows                  |                       330,535 |
| Accepted facts                      |                       330,533 |
| Rejected rows                       | 2: missing shop key; invalid repair amount |
| Distinct accepted records           |                       330,533 |
| Source shop keys                    |                           199 |
| Source shops mapped to PSG Hub      |                             1 |
| Arrival range                       | 2011-01-18 through 2026-08-14 |
| 2026 arrivals                       |                        19,229 |
| Recorded repair value               |             $1,671,343,984.99 |
| Rows with at least one quality flag |                         7,467 |

Customer and agent names, street addresses, emails, phones, birthdates, raw
repair-order numbers, raw serials, and the raw source payload are not stored. The
source record key is a SHA-256 digest. The new snapshot stays invisible while loading
and becomes current only after its accepted count reconciles in one final transaction.

## Payment and insurance analysis

| Classification | Repair orders | Interpretation                                           |
| -------------- | ------------: | -------------------------------------------------------- |
| Insurance      |       264,625 | Known insurance payment category                         |
| Customer       |        62,001 | Known customer-pay category                              |
| Third party    |         2,709 | Known third-party payment                                |
| Non-insurance  |            11 | Explicit non-insurance value                             |
| Fleet          |            37 | Fleet payment                                            |
| Warranty       |             2 | Warranty payment                                         |
| Other          |            14 | Total-loss variants; insurance status intentionally null |
| Unknown        |         1,134 | Missing or unrecognized category; never guessed          |

The leading normalized insurer labels across the complete export are:

| Insurer label         | Repair orders |    Repair value |
| --------------------- | ------------: | --------------: |
| State Farm            |        67,369 | $350,622,950.56 |
| Progressive Insurance |        30,144 | $163,635,937.78 |
| GEICO                 |        22,599 | $124,554,029.00 |
| Allstate              |        17,930 |  $96,463,950.51 |
| U S A A               |        15,927 |  $86,719,082.30 |

These are repairs tagged with those labels, not counts of all claims filed with those
insurers. The service-only alias queue contains every observed normalized label;
similar variants remain separate until a reviewer explicitly approves a canonical
key and display name.

## Geographic and vehicle analysis

The highest raw repair-order ZIP counts are 98391 (3,153), 96789 (2,735), 55044
(2,671), 72758 (2,546), and 47240 (2,520). These counts are useful for customer-market
concentration, weather exposure, and shop-specific marketing. They are not population-
or vehicle-normalized market-share estimates.

The leading normalized make/model combinations are:

| Vehicle      | Repair orders |   Repair value |
| ------------ | ------------: | -------------: |
| Toyota RAV4  |         8,810 | $41,673,192.18 |
| Honda CR-V   |         8,410 | $36,362,846.73 |
| Toyota Camry |         7,210 | $29,881,337.00 |
| Ford F-150   |         6,572 | $37,679,375.96 |
| Honda Civic  |         5,983 | $24,723,919.63 |

Vehicle mix can guide OEM certification, aluminum/EV capability, parts capacity, and
technician training. It does not by itself measure repair complexity; parts, labor,
calibration, and damage-severity data would be needed for that claim.

## Data-quality watchlist

| Quality flag                                   |  Rows |
| ---------------------------------------------- | ----: |
| Missing repair-order number                    | 5,541 |
| Unknown payment category                       | 1,134 |
| Zero repair amount                             |   671 |
| Insurer label on known non-insurance repair    |   178 |
| Missing insurer on insurance-classified repair |   150 |
| Completion before arrival                      |   124 |
| Missing customer ZIP                           |    31 |
| Invalid vehicle year                           |    30 |
| Invalid arrival date                           |    18 |
| Invalid completion date                        |     4 |

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

1. Resolve backup/restore ownership and alert routing, then separately approve the
   staged recurring FileMaker refresh timer.
2. Approve source-shop mappings one at a time and verify that each mapping replaces,
   rather than unions with, any legacy source for that PSG Hub shop.
3. Review and approve the highest-volume candidates in the insurer-alias queue; never
   infer a canonical carrier from spelling similarity alone.
4. Track weekly forecast MAE, WAPE, interval coverage, and drift only after real
   published forecasts and actuals accrue.
5. Keep severe-weather alerts review-only until ownership, acknowledgement, and
   false-positive thresholds are approved.
