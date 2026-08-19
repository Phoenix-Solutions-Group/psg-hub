# Tedesco Auto Body — Google Ads Post-Phase-1 Pull & Delta

**Pulled:** 2026-07-13 (production, first-party, read-only) | **Customer ID:** 7763526490 | **MCC:** 6935795509 (PSG)
**Source:** Credentialed production pull run by Ada on PSG-1323 (both windows queried together on 2026-07-13, same conversion-tracking config).
**Companion:** baseline audit `GOOGLE-ADS-REPORT.md` (2026-05-18); pull spec `POST-PHASE1-PULL-SPEC.md`.

---

## Top-line numbers (first-party, account-level totals)

| Window | Dates | Spend | Clicks | Impr | CTR | Conversions | CPA |
|---|---|---:|---:|---:|---:|---:|---:|
| **Post-fix** | Jun 11 – Jul 11, 2026 | $3,144.11 | 5,291 | 175,406 | 3.02% | 542.00 | $5.80 |
| **Re-baseline** (same conv basis) | Apr 18 – May 18, 2026 | $3,158.50 | 4,726 | 142,674 | 3.31% | 84.50 | $37.38 |

> The **re-baseline** re-queries the *original* baseline window (Apr 18 – May 18) with today's tracking config, so it is apples-to-apples with the post-fix window. It is NOT identical to the original 2026-05-18 audit table (which read $3,049.02 / 4,575 clicks / 70.50 conv / $43.25 CPA on the *old* conversion basis). Use the re-baseline row for any before/after math — see confounders.

## Delta (re-baseline → post-fix, same conversion basis)

| Metric | Before | After | Change |
|---|---:|---:|---|
| Spend | $3,158.50 | $3,144.11 | **−$14.39 (−0.5%)** — essentially flat |
| Clicks | 4,726 | 5,291 | **+565 (+12.0%)** |
| Impressions | 142,674 | 175,406 | **+32,732 (+22.9%)** |
| CTR | 3.31% | 3.02% | **−0.30pp** (slight dilution from wider reach — by design) |
| Conversions | 84.50 | 542.00 | +457.50 (+541%) — **see confounder #1, do not quote as pure lift** |
| CPA | $37.38 | $5.80 | −$31.58 (−84.5%) — **see confounder #1, do not quote as pure lift** |

## Health Score

**Not re-scored.** The 60/100 baseline came from the full 250-check audit run against the live account. The temporary production access used for this pull was one-time and has been removed, so I cannot responsibly re-run all 250 checks or fabricate a new score from aggregates alone. Directionally, spend discipline (flat spend) and traffic growth would lift several weighted checks; the conversion-tracking category can only be re-scored with live access. A fresh full audit is the right way to get a defensible new number if the case study needs one.

---

## Honest confounders (read before using any figure)

**#1 — The conversion / CPA delta is contaminated by a tracking change and must NOT be presented as a clean lift.**
The conversion-*tracking correction* was itself one of the May Phase-1 fixes. Conversion-config changes do not fully backfill history, so the pre-fix window under-counts conversions relative to how the account counts them today. The tell: conversion rate per click jumps from **1.79% → 10.24% (5.7×)** on flat spend and only +12% clicks. A 5.7× conversion-rate jump is not plausibly pure campaign performance — it is dominated by a change in *what/how we count*. Treat the +541% conversions and −84.5% CPA as **directionally positive but not a quotable magnitude** until a per-conversion-action breakdown confirms the counting basis was constant across both windows.

**#2 — The baseline window is itself partly post-fix (pushes the lift the other way).**
The May fixes landed ~2026-05-12, *inside* the Apr 18 – May 18 baseline window. So the "before" already contains ~6 days of partially-fixed campaigns, which *understates* any real improvement. Confounders #1 and #2 push in opposite directions.

**#3 — Seasonality.**
June–July vs April–May. Collision/auto-body demand has mild seasonality; not a large swing, but the post window is a different season than the baseline, so a slice of the traffic growth is calendar, not campaign.

**#4 — No mid-window budget shock detected.** Spend is flat between windows (−0.5%), so there is no major budget change inflating or deflating the comparison at the account level. (Per-campaign pause/launch mix was not broken out in this aggregate pull.)

---

## What is safe to say in the case study (defensible signals)

- **Cost held flat** (−0.5%) while **traffic grew** — clicks +12%, impressions +23%. Clean, uncontaminated, first-party.
- **CTR essentially stable** (3.37%→3.02% vs original; 3.31%→3.02% same-basis) — the wider-reach strategy diluted CTR slightly *by design*, not a regression.
- **Conversions and CPA moved strongly in the right direction**, but the magnitude is entangled with the conversion-tracking fix — frame as "materially improved lead capture and cost-per-lead" without a precise % until the counting basis is verified.

## To turn the conversion story into a quotable number

Pull a **per-conversion-action breakdown** for both windows (same query, segmented by conversion action + `conversions` and `all_conversions`). If the same action set was live and firing in both windows, the lift is real and quotable. If new actions appear only post-fix, isolate the like-for-like actions and report *that* delta. That is a small follow-up pull, not a new framework.
