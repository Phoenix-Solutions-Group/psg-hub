# Multi-shop Collision Demand Evaluation

**Evaluated:** 2026-08-18
**Decision:** approve `trailing4_v1` only for explicitly mapped shops where its
shop-level chronological holdout beats the registered seasonal baseline

## Evaluation design

- Source: privacy-safe FileMaker repair facts at the source-shop and Monday-start
  week grain.
- Frame: `v_collision_filemaker_forecast_training_weekly`, with zero-demand weeks
  retained and one-, four-, and 52-week lags computed per source shop.
- Eligibility: at least 104 weeks of history with a 52-week seasonal lag.
- Split: the 52 weeks before the holdout calibrate prediction intervals; the latest
  52 weeks are the final chronological holdout for each shop.
- Models: same week 52 weeks earlier, trailing four-week mean, and a 50/50 blend.
- Multi-horizon test: horizons 1–4 share one forecast-origin cutoff. For horizon
  `h`, the trailing mean uses the four completed weeks before that origin; no
  intervening target-week outcomes are visible to the model.
- Interval-policy validation: source shops are assigned deterministically to a
  calibration or validation group. Validation shops do not set the interval
  multiplier.
- Current-shop segment: shops with an arrival during or after 2026-06-22.

Random train/test splits are not used. Unmapped source shops are evaluation evidence
only; they cannot produce a PSG Hub shop forecast.

## Results

| Evaluation population | Eligible shops | Holdout shop-weeks | Holdout repairs | Seasonal MAE | Trailing-4 MAE | MAE improvement | Shops where trailing-4 wins |
| --------------------- | -------------: | -----------------: | --------------: | -----------: | -------------: | --------------: | --------------------------: |
| All history           |             94 |              4,888 |          45,600 |       4.4114 |     **2.8512** |       **35.4%** |                    92 of 94 |
| Current-shop segment  |             30 |              1,560 |          16,113 |       4.4051 |     **2.9856** |       **32.2%** |                    30 of 30 |

For all eligible shops, trailing-4 WAPE was 30.6% versus 47.3% for the seasonal
baseline. Within the current-shop segment, trailing-4 WAPE was 28.9% versus 42.6%.
The blend was the individual shop champion for 11 of the 30 current shops; trailing-4
was champion for the other 19. No current shop selected the seasonal baseline.

### Four-week current-shop backtest

| Horizon | Seasonal MAE | Trailing-4 MAE | MAE improvement | Trailing-4 WAPE | Held-out-shop interval coverage |
| ------: | -----------: | -------------: | --------------: | --------------: | ------------------------------: |
|       1 |         4.41 |           2.99 |           32.2% |           28.9% |                           92.3% |
|       2 |         4.41 |           3.07 |           30.4% |           29.7% |                           93.8% |
|       3 |         4.41 |           3.12 |           29.2% |           30.2% |                           92.7% |
|       4 |         4.41 |           3.20 |           27.4% |           31.0% |                           93.3% |

Trailing-4 beats seasonal at all four aggregate horizons. For PS177 specifically,
trailing-4 remains the shop champion for horizons 1–3; the seasonal/recent blend is
the horizon-4 champion. The promoted PS177 intervals are therefore horizon-specific:
±9, ±8, ±7, and ±8 repairs, respectively.

## Operating interval policy

The unadjusted trailing-4 interval covered 73.5% of current-shop holdout weeks. A
multiplier of **1.55** was selected using 14 calibration shops. It covered **92.3%**
of holdout weeks across the separate 16-shop validation group.

For horizons 2–4, the same deterministic shop split selected multipliers of 1.70,
1.60, and 1.55 for the promoted PS177 models. Held-out-shop coverage was 93.8%,
92.7%, and 92.1%. Coverage is measured separately by horizon; week-1 evidence is not
silently reused for later weeks.

For the mapped PS177 pilot, the calibrated shop interval half-width is 5.25 repairs.
Applying the cross-shop multiplier and rounding outward produces the registered
operating interval of **plus or minus 9 repairs**. This is intentionally conservative;
92.3% is an observed validation result, not a guarantee of future coverage.

## Promotion and publication policy

`collision_forecast_model_registry` is the forecast promotion gate. An approved row
must record a lower model MAE than the seasonal baseline. The weekly scorer reads the
approved model and interval from that registry; it does not silently choose a model
at scoring time.

Week 1 remains in that registry. `collision_forecast_horizon_registry` records
independently approved evidence for weeks 2–4. Forecast rows retain origin week,
target week, and horizon so later outcomes can measure accuracy by forecast vintage.

A forecast is published only when:

1. the source shop is explicitly mapped to the authenticated PSG Hub `shop_id`;
2. the shop has an approved model that beat its seasonal baseline;
3. the latest repair arrival is no more than 14 days old; and
4. sufficient lag history is present.

The current PS177 forecast remains `stale_source`, with no predicted, lower, or upper
value, because its latest arrival is 2025-12-24. The newer evaluation shops are not
mapped and therefore cannot be published.

## Limits

- The current-shop interval validation contains 16 held-out shops; it should be
  rerun as more mapped shops and live outcomes become available.
- The FileMaker snapshot ends 2026-07-10. This is historical validation, not proof
  that a recurring ingest is operational.
- Shop demand can change after staffing, insurer relationships, acquisitions, or
  process changes. Live MAE, WAPE, coverage, and drift monitoring are still needed.
- Crash and weather data remain context and alert inputs because they did not beat
  the simple repair-history champion.
- The model predicts weekly repair arrivals. It does not predict an individual crash,
  a damaged vehicle, or insurer claim volume.

## Reproduce

```bash
python3 scripts/evaluate-collision-demand-features.py \
  --env-file /absolute/path/to/apps/psg-hub/.env.local \
  --all-filemaker
```

```bash
python3 scripts/evaluate-collision-demand-features.py \
  --env-file /absolute/path/to/apps/psg-hub/.env.local \
  --all-filemaker \
  --latest-week-cutoff 2026-06-22 \
  --forecast-horizons 4
```
