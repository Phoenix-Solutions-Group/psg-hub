# Weekly Collision-Repair Demand Baseline

**Evaluated:** 2026-08-18
**Outcome:** the trailing four-week model beat the registered 52-week seasonal baseline

## Evaluation design

- Target: weekly repair-order arrivals.
- Grain: one company and Monday-start week.
- Training frame: 2019-11-18 through 2025-12-22.
- Holdout: the final 52 weeks, 2024-12-30 through 2025-12-22.
- Holdout volume: 423 repair orders.
- Split: chronological; no random shuffling.
- Zero-demand weeks: retained in the modeling frame.
- Source: `public.v_collision_forecast_training_weekly`.

## Results

| Model | MAE | RMSE | WAPE |
|---|---:|---:|---:|
| Same week 52 weeks earlier | 3.63 | 4.93 | 44.7% |
| Trailing four-week average | **2.65** | **3.25** | **32.6%** |
| 50/50 seasonal and recent blend | 2.87 | 3.62 | 35.3% |

The trailing four-week model reduced mean absolute error by **27.0%** relative to
the registered seasonal baseline. It is the initial operational champion.

## Interpretation

The pilot shop's recent workload is more informative than its same-week-prior-year
volume. This is useful for short-term staffing and scheduling, but the 32.6% WAPE
is not yet precise enough for automatic capacity decisions without a confidence
band and operator review.

Weather is present in the governed training view as prior-month exposure but is not
used in this baseline comparison. The next model should test whether weather,
seasonality, vehicle mix, and market crash signals improve a strictly later holdout.
Those features should be kept only if they outperform this registered champion.

## Scope warning

The operational training view currently contains 3,420 FileMaker repairs mapped to
Collision Leaders of Derby and zero legacy pilot rows. These results are pilot-only
and must not be represented as a fleet-wide PSG model. Retrain and report per-company
performance as additional shop histories are explicitly mapped.

## Reproduce

Run the live view through the evaluator:

```bash
supabase db query --linked --output json \
  "select week_start, repair_orders, repair_orders_lag_52_weeks, trailing_4_week_average from public.v_collision_forecast_training_weekly order by company_id, week_start" \
  | python3 scripts/evaluate-collision-demand-baseline.py
```

Run the evaluator self-check:

```bash
python3 scripts/evaluate-collision-demand-baseline.py --self-test
```
