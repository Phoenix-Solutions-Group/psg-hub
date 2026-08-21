# Crash and Weather Feature Evaluation

**Evaluated:** 2026-08-18
**Outcome:** KDOT crash history adds a small signal, but does not beat the simple
trailing four-week repair-demand model

## Evaluation design

- Target: weekly repair-order arrivals for the pilot company.
- Training: 2020-11-16 through 2023-12-25.
- Interval calibration: 2024-01-01 through 2024-12-23.
- Final holdout: 2024-12-30 through 2025-12-22 (52 weeks, 423 repairs).
- Crash features: prior completed month's KDOT crashes and rain/snow crashes in
  the repair-customer ZIP portfolio.
- Weather feature: prior completed month's repair-weighted NOAA storm score.
- Ridge penalty: fixed before the holdout; features standardized on training data.
- Prediction intervals: 80th-percentile absolute error from the calibration year.

## Results

| Model                           |      MAE |     RMSE |      WAPE | 80% interval | Holdout coverage |
| ------------------------------- | -------: | -------: | --------: | -----------: | ---------------: |
| Same week 52 weeks earlier      |     3.63 |     4.93 |     44.7% |         ±6.0 |            84.6% |
| Trailing four-week average      | **2.65** | **3.25** | **32.6%** |        ±5.25 |            90.4% |
| Seasonal/recent blend           |     2.87 |     3.62 |     35.3% |        ±4.88 |            84.6% |
| Ridge: demand only              |     3.10 |     3.82 |     38.1% |        ±4.98 |            80.8% |
| Ridge: demand + KDOT crashes    |     3.03 |     3.74 |     37.3% |        ±4.67 |            76.9% |
| Ridge: demand + NOAA weather    |     3.10 |     3.83 |     38.2% |        ±4.99 |            80.8% |
| Ridge: demand + crash + weather |     3.04 |     3.75 |     37.3% |        ±4.67 |            76.9% |

KDOT crash features lowered MAE by **2.1%** versus the comparable demand-only
ridge model. Weather increased MAE by **0.2%**. Neither feature set beat the
registered trailing four-week champion.

## Decision

Keep KDOT crashes and NOAA weather as dashboard context and alert inputs. Do not
promote them into the weekly repair forecast yet. Once current repair ingestion is
restored, score the trailing four-week model weekly with an initial empirical
shop interval of **±5.25 repairs**. The promotion registry now widens this to a
conservative **±9 repairs** using the earlier cross-shop policy. The first governed
refresh produced a gap-aware 44-shop validation set; it selected 1.10× for horizon 1
with 81.5% held-out-shop coverage and did not automatically change the registered
interval. Monitor observed coverage and retest features on a new strictly later
holdout before reapproval.

The figures above were rerun after the complete FileMaker snapshot replaced the
legacy pilot source. The mapped modeling frame now reconciles to 3,420 FileMaker
repairs and zero legacy rows.

This predicts shop repair arrivals, not individual crashes or insurer claim volume.
The feature result is for one company. Separate multi-shop validation supports the
simple demand-history model and interval policy, but each mapped shop still needs its
own approved registry row before publication.

## Reproduce

```bash
python3 scripts/evaluate-collision-demand-features.py \
  --env-file /absolute/path/to/apps/psg-hub/.env.local \
  --shop-id 2d1465c0-6baf-4d29-b983-489d386b38f4
```

```bash
python3 scripts/evaluate-collision-demand-features.py --self-test
```
