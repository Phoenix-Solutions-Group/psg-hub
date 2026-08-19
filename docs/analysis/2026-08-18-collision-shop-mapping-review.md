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

## Current candidates

| Source | FileMaker name                     | PSG Hub candidate                  | Name signal | Evidence                                                                   | Review decision                                                                                                                                 |
| ------ | ---------------------------------- | ---------------------------------- | ----------: | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PS1650 | Flower Hill Auto Body - Huntington | Flower Hill Auto Body — Huntington |       1.000 | 52 repairs; latest 2026-06-23                                              | Identity appears exact, but history is insufficient for a 52-week calibration plus 52-week holdout; confirm identity before descriptive mapping |
| PS773  | Tedesco Auto Body, Inc.            | Tedesco Auto Body                  |       0.818 | 1,116 repairs; latest 2026-07-08; trailing-4 MAE 2.54 versus seasonal 6.75 | Strong identity candidate; forecast approval blocked because the calibration interval is zero and holdout interval coverage is only 1.9%        |
| PS229  | Tracy’s Collision Center South     | Tracy's Collision Center           |       0.828 | 6,646 repairs; blend MAE 3.35 versus seasonal 4.42                         | Blocked: South and North both point to one generic PSG Hub shop                                                                                 |
| PS228  | Tracy’s Collision Center North     | Tracy's Collision Center           |       0.800 | 4,567 repairs; blend MAE 2.77 versus seasonal 3.58                         | Blocked: requires distinct PSG Hub locations or an explicit consolidation rule                                                                  |

## Recommended first action

Confirm whether FileMaker PS773 is the same operating location as the PSG Hub
Tedesco Auto Body shop. If approved, map it for descriptive repair, insurer, ZIP,
vehicle, weather, and crash analytics, but leave its model registry unapproved. Then
refresh or backfill the missing calibration-period repair history and rerun:

```bash
python3 scripts/evaluate-collision-demand-features.py \
  --env-file /absolute/path/to/apps/psg-hub/.env.local \
  --source-shop-key PS773
```

Do not publish a Tedesco numeric forecast until the recalibrated interval is nonzero,
its held-out coverage is reported, and the latest repair arrival is within 14 days.
