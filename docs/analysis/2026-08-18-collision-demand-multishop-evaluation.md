# Multi-shop Collision Demand Evaluation

**Evaluated:** 2026-08-18; refreshed 2026-08-19 after the first governed import
**Decision:** approve `trailing4_v1` only for explicitly mapped shops where its
shop-level chronological holdout beats the registered seasonal baseline

## Evaluation design

- Source: privacy-safe FileMaker repair facts at the source-shop and Monday-start
  week grain.
- Frame: `v_collision_filemaker_forecast_training_weekly`, with zero-demand weeks
  retained and one-, four-, and 52-week lags computed per source shop.
- Coverage gaps: evaluation starts after the latest internal run of more than 26
  zero-repair weeks. Such a run is treated as unknown source coverage, not observed
  zero demand. Explicit FileMaker coverage intervals should replace this conservative
  heuristic when available.
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

| Evaluation population | Eligible shops | Holdout shop-weeks | Holdout repairs | Seasonal MAE | Trailing-4 MAE | MAE improvement | Trailing-4 champions |
| --------------------- | -------------: | -----------------: | --------------: | -----------: | -------------: | --------------: | --------------------------: |
| All history           |             79 |              4,108 |          40,718 |         4.25 |       **3.01** |       **29.0%** |                    50 of 79 |
| Current-shop segment  |             44 |              2,288 |          23,585 |       3.8864 |     **2.9986** |       **22.8%** |                    27 of 44 |

For all eligible shops, trailing-4 WAPE was 30.4% versus 42.8% for the seasonal
baseline. Within the current-shop segment, trailing-4 WAPE was 29.1% versus 37.7%.
The blend was the individual shop champion for 17 of the 44 current shops; trailing-4
was champion for 27. No current shop selected the seasonal baseline at horizon 1.

### Four-week current-shop backtest

| Horizon | Seasonal MAE | Trailing-4 MAE | MAE improvement | Trailing-4 WAPE | Held-out-shop interval coverage |
| ------: | -----------: | -------------: | --------------: | --------------: | ------------------------------: |
|       1 |         3.89 |           3.00 |           22.8% |           29.1% |                           81.5% |
|       2 |         3.89 |           3.05 |           21.6% |           29.5% |                           81.6% |
|       3 |         3.89 |           3.09 |           20.4% |           30.0% |                           78.8% |
|       4 |         3.89 |           3.13 |           19.6% |           30.3% |                           78.6% |

### South Lincoln pilot candidate

A read-only production evaluation on 2026-08-20 used FileMaker source `PS229`
through the completed week of 2026-08-03. The seasonal/recent blend beat the
52-week seasonal baseline at all four horizons: 24.0%, 23.2%, 24.1%, and 20.1%
lower MAE. Its held-out-shop interval coverage was 80.4%, 83.0%, 83.0%, and
85.1%, respectively, so all four horizons clear the current review threshold.

The evidence is not staged or approved. `PS229` remains unmapped, and the exact
South Lincoln Hub shop at 1500 Center Park Road has no customer member. A read-only
2026-08-20 recheck found zero customer-role members across South Lincoln, North
Lincoln, and the related demo shop. PSG must therefore invite the intended customer
or explicitly assign an existing customer; PSG staff memberships do not clear the
forecast audience gate.

On 2026-08-21 the user confirmed FileMaker PS229 is Tracy's Collision South Lincoln.
That identity decision does not auto-map the shop: the governed address-evidence
migration, explicit mapping approval, and intended customer audience remain separate
gates.

Trailing-4 beats seasonal at all four aggregate horizons. For PS177 specifically,
trailing-4 remains the shop champion for horizons 1–3; the seasonal/recent blend is
the horizon-4 champion. The promoted PS177 intervals are therefore horizon-specific:
±9, ±8, ±7, and ±8 repairs, respectively.

## Operating interval policy

The unadjusted trailing-4 interval covered 78.5% of current-shop holdout weeks. A
multiplier of **1.10** was selected using 22 calibration shops. It covered **81.5%**
of holdout weeks across the separate 22-shop validation group.

For horizons 2–4, the same deterministic shop split selected multipliers of 1.10,
1.05, and 1.00. Held-out-shop coverage was 81.6%, 78.8%, and 78.6%. Coverage is
measured separately by horizon; week-1 evidence is not silently reused for later
weeks. Horizons 3–4 remain below the nominal 80% target and require more observed
evidence before any new policy is promoted.

For the mapped PS177 pilot, the calibrated shop interval half-width is 5.25 repairs.
The registry still carries the earlier conservative **plus or minus 9 repairs**
policy; this refreshed evaluation does not silently change a promoted model or
interval. Reapproval must consider the new gap-aware evidence and later observed
forecast coverage.

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

- The current-shop interval validation contains 22 held-out shops; it should be
  rerun as more mapped shops and live outcomes become available.
- The FileMaker snapshot ends 2026-08-14. The first manual import reconciled, but the
  recurring refresh remains disabled pending backup/restore ownership and alerting.
- Eleven of 55 current-source candidates lack sufficient post-gap history. PS773 is
  among them; its apparent zero-width interval came from treating a multi-year
  coverage gap as observed zero demand and is no longer accepted as model evidence.
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
