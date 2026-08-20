# Collision Weather Alert Follow-Through Backtest

**Evaluated:** 2026-08-20  
**Decision:** keep customer notifications disabled; retain the dashboard as a review queue

## Question

When a repair-customer ZIP has a severe-weather threshold crossing, does PSG observe
an unusual increase in repair arrivals during the next calendar month?

This is a historical proxy for the live 72-hour NOAA SPC queue. It evaluates final
NCEI ZIP-month weather history because PSG has not yet accumulated enough live alert
outcomes. It does not validate individual weather reports, vehicle damage, crashes,
or insurer claim volume.

## Leakage-safe method

- Repair input: 330,481 privacy-safe FileMaker facts with a valid arrival date from
  2016 onward.
- Evaluated coverage: 106 source shops and 7,301 customer ZIPs with a loaded ZIP
  boundary and enough prior seasonal history.
- Severe-weather proxy: any final NCEI ZIP-month containing a tornado, hail of at
  least 1 inch, or wind of at least 50 knots (approximately 58 mph).
- Outcome: the next calendar month's shop/ZIP repair arrivals exceed the average for
  that same calendar month in prior years and total at least two repairs.
- Baseline: prior years only, with at least two prior same-month observations.
- Portfolio eligibility: a shop/ZIP enters only after its first observed repair.
  Prior-repair tiers use only history available before the weather month.
- Freshness: the next month must be complete relative to that source shop's latest
  repair arrival.
- Uncertainty: follow-through rates include Wilson 95% intervals.

## Result

| Cohort                      |   Cases | Follow-through | 95% interval | Average repairs vs seasonal baseline |
| --------------------------- | ------: | -------------: | -----------: | -----------------------------------: |
| Severe-threshold ZIP-months |  21,795 |          4.89% |  4.61%–5.18% |                               -0.047 |
| No-severe-threshold control | 391,458 |          4.39% |  4.33%–4.45% |                               -0.071 |

The severe-weather cohort's follow-through rate is only **0.50 percentage points**
above the control rate. The large sample makes that difference detectable, but the
effect is too small to justify broad customer notifications or automatic operational
changes.

### Prior customer-ZIP repair history

| Repairs known before signal | Signal cases | Signal rate | Control rate |         Lift |
| --------------------------- | -----------: | ----------: | -----------: | -----------: |
| 0–4                         |       13,800 |       0.10% |        0.09% | +0.01 points |
| 5–9                         |        2,552 |       1.68% |        1.14% | +0.54 points |
| 10–24                       |        2,367 |       5.87% |        4.97% | +0.90 points |
| 25+                         |        3,076 |      28.25% |       26.09% | +2.16 points |

Follow-through rises sharply with existing market volume in both the signal and
control cohorts. Even in ZIPs with 25 or more prior repairs, 71.75% of threshold
crossings are not followed by an unusual next-month arrival increase. Historical ZIP
volume is therefore useful context, but it does not make the weather signal precise
enough for automated outreach.

### Weather combinations

- Hail-only: 5.73% follow-through across 6,007 cases.
- Wind-only: 4.37% across 12,746 cases.
- Tornado-only: 5.66% across 884 cases.
- Tornado + hail + wind: 10.98% across 82 cases, with a wide 5.88%–19.56%
  interval. This is appropriate for manual review, not an automatic policy.

## Product decision

1. Keep notifications disabled.
2. Label candidates **Severe threshold met**, not **High signal**. The threshold
   describes weather severity, not predicted repair demand.
3. Continue showing historical ZIP repair volume as market context.
4. Do not change staffing, scheduling, parts, or marketing from a weather candidate
   alone. Confirm booked work and governed repair-demand forecasts first.
5. Before notifications can be authorized, name an alert owner and lifecycle,
   pre-register an economically meaningful lift and false-positive tolerance, and
   validate exact 1–4 week outcomes from live preliminary SPC alerts against matched
   controls. Statistical significance without useful effect size is insufficient.

The staged dashboard lifecycle now covers the manual-review portion: a current shop
owner or manager can acknowledge and own a severe-threshold signal, then close it as
observed follow-through, no observed follow-through, or not evaluable with written
evidence. It remains unapplied in production, sends nothing externally, and does not
replace the still-missing organization-level notification owner, economic threshold,
or prospective matched-control validation.

## Limitations

- ZIP-month timing cannot isolate whether repair activity occurred before or after a
  specific event inside that month.
- Final NCEI records are a proxy for preliminary SPC reports and may differ in event
  location, timing, and revision behavior.
- A no-follow-through case means PSG did not observe unusual next-month repair
  arrivals. It does not mean the weather report itself was false.
- Source-shop capture varies by market. PSG does not have complete insurer claim
  counts, so the result is about shop repair arrivals only.

## Reproduce

```bash
python3 scripts/evaluate-collision-weather-alerts.py \
  --env-file /absolute/server-secret/path/.env.local \
  --project-id gylkkzmcmbdftxieyabw
```

The command is read-only and emits aggregate JSON. It does not persist repair rows or
change Supabase.

## Source semantics

- [NCEI Storm Data bulk format](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf)
  defines hail magnitude in inches and wind magnitude in knots.
- [NCEI Storm Events FAQ](https://www.ncei.noaa.gov/stormevents/faq.jsp) documents
  wind magnitude codes and the knot-to-mph conversion.
