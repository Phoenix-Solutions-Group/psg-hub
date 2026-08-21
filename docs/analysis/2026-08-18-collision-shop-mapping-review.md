# Collision Source-shop Mapping Review

**Reviewed:** 2026-08-19
**Decision:** no source shop was auto-mapped; 1 mapping is active and 198 await review

## Rules

- A source-to-PSG-shop mapping requires explicit approval; name similarity is only a
  review signal.
- `shop_id` is the tenant and forecast key. Company attribution is optional.
- One PSG Hub shop can have only one active collision source mapping, enforced by a
  partial unique database index.
- Mapping enables descriptive shop analytics. Numeric forecasts still require a
  separately approved model that beats the seasonal baseline, has a credible
  interval, and passes the 14-day freshness gate.

## Approval workflow

PSG superadmins review mappings at `/dashboard/collision-intelligence/review`.
Approval requires an available PSG Hub shop, written identity evidence, and an
explicit confirmation. The service-only database function validates the actor and
both sides of the mapping, prevents concurrent or duplicate assignments, updates the
mapping, and records `collision.shop_mapping.approve` in `access_audit` in one
transaction. No candidate is approved from name similarity alone.

The evidence table shows the eight highest-2026-volume source shops. The approval
selector contains all 198 unmapped source shops, so a verified candidate is no longer
excluded merely because it is outside the eight highest lifetime-volume rows.

## Current candidates

| Source | FileMaker name                     | PSG Hub candidate                  | Name signal | Evidence                                                                   | Review decision                                                                                                                                 |
| ------ | ---------------------------------- | ---------------------------------- | ----------: | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PS1650 | Flower Hill Auto Body - Huntington | Flower Hill Auto Body — Huntington |       1.000 | 61 repairs; latest 2026-06-25                                               | Identity appears exact, but history is insufficient for a 52-week calibration plus 52-week holdout; confirm identity before descriptive mapping |
| PS773  | Tedesco Auto Body, Inc.            | Tedesco Auto Body                  |       0.818 | 1,152 repairs; 241 in 2026; latest 2026-08-05                              | Strong identity candidate for descriptive mapping; forecast evaluation is ineligible after the 2021–2025 source-coverage gap is excluded        |
| PS229  | Tracy’s Collision Center South     | Tracy's Collision Center           |       0.828 | 6,752 repairs; 508 in 2026; latest 2026-08-12                              | Blocked: South and North both point to one generic PSG Hub shop                                                                                 |
| PS228  | Tracy’s Collision Center North     | Tracy's Collision Center           |       0.800 | 4,630 repairs; 326 in 2026; latest 2026-08-12                              | Blocked: requires distinct PSG Hub locations or an explicit consolidation rule                                                                  |

## Recommended first action

Confirm whether FileMaker PS773 is the same operating location as the PSG Hub
Tedesco Auto Body shop. If approved, map it for descriptive repair, insurer, ZIP,
vehicle, weather, and crash analytics, but leave its model registry unapproved. Its
weekly frame contains no repairs from June 2021 through May 2025. The evaluator now
treats internal zero runs longer than 26 weeks as unknown source coverage instead of
zero demand; only 62 weeks remain after the gap, below the required post-gap seasonal
lag, calibration, and holdout history. Backfill or explicitly prove the missing
coverage before rerunning:

```bash
python3 scripts/evaluate-collision-demand-features.py \
  --env-file /absolute/path/to/apps/psg-hub/.env.local \
  --source-shop-key PS773
```

Do not publish a Tedesco numeric forecast until it has sufficient continuous
post-gap history, a nonzero calibrated interval, reported held-out coverage, and a
latest repair arrival within 14 days.
