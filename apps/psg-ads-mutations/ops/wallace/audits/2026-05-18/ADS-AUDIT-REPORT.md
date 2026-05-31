# Wallace Collision Center — Google Ads Audit

**Account:** Wallace Collision Center (CID `6048611995`)
**Date:** 2026-05-18
**Window analyzed:** Last 30 days
**Business type:** Collision repair (NAICS 81112), local service
**Active platforms:** Google Ads only

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Aggregate Ads Health Score | **44 / 100 (D)** |
| Google Ads Score | 44 / 100 |
| Account optimization score | 62.7% (weight 300.13) |
| Last-30d spend (active + recently paused) | ~$3,384 |
| Last-30d reported conversions | 744 (inflated — see Conversion section) |
| Active enabled campaigns | 6 search + 1 Smart |
| Paused campaigns serving status SERVING | 6 (historical data still appearing) |

### Top 5 Critical Issues

1. **Brand campaign paused.** `GOOG_WAL_SRCH_Brand_2026Q2` is PAUSED. Brand search is the cheapest conversion path and competitors can poach the SERP. Highest-ROI lever in the account is dormant.
2. **Conversion action sprawl + signal pollution.** 21 conversion actions; 12 flagged `primary_for_goal=true`, mixing form submits, GA4 qualify_lead (MANY_PER_CLICK), Smart-campaign call clicks, and ad-call clicks. Real CPA hidden behind 607 "conversions" on $1,066 spend in PPC_Wallace_40Miles.
3. **Quality Score crisis.** 107 keywords have measurable QS; **0 above 5**. Distribution: QS1=27, QS2=30, QS3=34, QS4=8, QS5=8. Landing page experience BELOW_AVERAGE on almost every top-spend keyword. CPC inflation ~30–60% versus QS7+ baseline.
4. **Search-term leakage on OEM-certified campaigns.** Tesla Approved spent ~$250+ on non-collision queries: `tesla dealership`, `tesla model 3 battery replacement`, `tesla bumper`, `tesla paint repair kit`, `tesla service`, `tesla website`, `cybertruck`, `tesla extended warranty`, `tesla ceramic coating`, `tesla tires`, `tesla model y`. JLR same pattern: `jaguar f pace maintenance cost`, `land rovers`, `2017 range rover`, `jaguar vanden plas`.
5. **Wallace_40Miles rank-lost IS 77%.** Campaign loses 77% of available impressions to ad rank (QS + bid). Combined with 13% budget loss, only 10% impression share captured.

### Top 5 Quick Wins (<15 min each)

1. **Enable brand campaign** `GOOG_WAL_SRCH_Brand_2026Q2` (cid 23825006324) — fix bidding strategy first (`TARGET_IMPRESSION_SHARE` with $7/d will starve; switch to `MAXIMIZE_CLICKS` capped or `MANUAL_CPC` and raise budget to $15–20/d).
2. **Add negative keywords sitewide:** `dealership`, `dealer`, `for sale`, `lease`, `buy`, `parts`, `tires`, `windshield`, `battery`, `extended warranty`, `service appointment`, `maintenance cost`, `coupons`, `accessories`, `2015`, `2017`, `2023`. Apply to Tesla Approved, JLR Certified Collision Repairs, BMW Certified, Rivian Approved.
3. **Pause Smart campaign `Wallace Ford of Kingsport Brand`** if not the correct entity (this is a dealer brand campaign in a collision repair account) — verify business scope, then pause or migrate.
4. **Remove `primary_for_goal=true` from non-critical conversions:** `Local actions - Directions`, `Local actions - Website visits`, `Local actions - Other engagements`, `Local actions - Menu views`, `Smart campaign map clicks to call`, `Smart campaign map directions`. Keep primary: `Form`, `Calls from ads`, `GA4 qualify_lead`. Use `python -m ops.wallace.fix_qualify_lead_category` pattern.
5. **Pause keywords with QS=1 or QS=2 and zero/negative ROI**: `paint body shop near me` (QS1), `collision center near me` (QS2), `tesla certified shop` (QS2), `tesla approved body shops near me` (QS2), `tesla auto body shops near me` (QS2), `tesla repair near me` (QS2). Re-add as PHRASE or EXACT after fixing landing page.

---

## Google Ads — Detailed Findings

### Category Breakdown

| Category | Weight | Score | Grade |
|----------|--------|-------|-------|
| Conversion Tracking | 25% | 12 / 25 | D |
| Wasted Spend | 20% | 8 / 20 | D |
| Account Structure | 15% | 8 / 15 | C |
| Keywords | 15% | 4 / 15 | F |
| Ads | 15% | 6 / 15 | D |
| Settings | 10% | 6 / 10 | C |
| **Total** | 100% | **44 / 100** | **D** |

---

### 1. Conversion Tracking (12 / 25)

**Customer-level (good):**
- Auto-tagging: **ENABLED** ✓
- Enhanced Conversions for Leads: **ENABLED** ✓
- Customer Data Terms accepted: **TRUE** ✓
- GCLID/cross-account: customers/6048611995 (own)

**Conversion action inventory (21 total):**

| Name | Type | Category | Primary | InMetric | Count |
|------|------|----------|---------|----------|-------|
| Form | GA4_CUSTOM | SUBMIT_LEAD_FORM | ✓ | ✓ | 1/click |
| Calls from ads | AD_CALL | PHONE_CALL_LEAD | ✓ | ✓ | many |
| GA4 qualify_lead | GA4_CUSTOM | SUBMIT_LEAD_FORM | ✓ | ✓ | many |
| Smart campaign tracked calls | SMART_CALL | PHONE_CALL_LEAD | ✓ | ✓ | 1 |
| Smart campaign ad clicks-to-call | SMART_AD_CTC | CONTACT | ✓ | ✓ | many |
| Landing Page | WEBPAGE | SUBMIT_LEAD_FORM | ✗ | ✗ | many |
| Local actions — Directions | GOOGLE_HOSTED | GET_DIRECTIONS | ✓ | ✗ | many |
| Local actions — Website visits | GOOGLE_HOSTED | PAGE_VIEW | ✓ | ✗ | many |
| Local actions — Other engagements | GOOGLE_HOSTED | ENGAGEMENT | ✓ | ✗ | many |
| Local actions — Menu views | GOOGLE_HOSTED | PAGE_VIEW | ✓ | ✗ | many |
| Smart campaign map clicks-to-call | SMART_MAP_CTC | CONTACT | ✓ | ✗ | many |
| Smart campaign map directions | SMART_MAP_DIR | GET_DIRECTIONS | ✓ | ✗ | many |
| Store visits | STORE_VISITS | STORE_VISIT | ✓ | ✗ | many |
| Clicks to call | GOOGLE_HOSTED | CONTACT | ✓ | ✗ | many |
| Wallace Ford GA4 purchase | GA4_PURCHASE | PURCHASE | ✗ | ✗ | many (HIDDEN) |
| Wallace Ford GA4 ctc | GA4_CUSTOM | PHONE_CALL_LEAD | ✗ | ✗ | many (HIDDEN) |
| Wallace Ford GA4 all_elements | GA4_CUSTOM | PAGE_VIEW | ✗ | ✗ | many (HIDDEN) |
| Wallace Collision GA4 purchase | GA4_PURCHASE | PURCHASE | ✗ | ✗ | many (HIDDEN) |
| Wallace Collision GA4 close_convert_lead | GA4_CUSTOM | PAGE_VIEW | ✗ | ✗ | many (HIDDEN) |
| CROToolkitLandingPage | WEBPAGE | SUBMIT_LEAD_FORM | (removed) | — | — |
| CROToolkitPopup | WEBPAGE | SUBMIT_LEAD_FORM | (removed) | — | — |

**Findings:**

- **G01 ❌ Smart-bidding signal mixed**: `GA4 qualify_lead` is MANY_PER_CLICK and primary — inflates count; Smart bidder optimizes for repeated form opens / qualify-lead events instead of unique submissions. Convert to ONE_PER_CLICK or remove `primary_for_goal`.
- **G02 ❌ Smart-campaign ad-clicks-to-call counted in metric**: pollutes Search-campaign optimization. Smart campaign signals should not feed Search Max-Conv bidding. Set `include_in_conversions_metric=false` for `Smart campaign ad clicks to call` (id 7258748379).
- **G03 ⚠ Wallace Ford GA4 events HIDDEN but exist**: `Wallace Ford of Kingsport (web) purchase`, `…click_to_call`, `…all_elements` are tied to a Ford dealer property in a collision repair account. Either remove or confirm scope.
- **G04 ✓ Landing Page (519845175) correctly secondary**: not optimizing on raw pageview.
- **G05 ❌ Store visits enabled** but `include_in_conversions_metric=false`. If foot traffic matters, set to true for non-Smart-Bidding signal use; otherwise fine.
- **G06 ⚠ Removed actions still flagged primary**: `CROToolkitLandingPage` and `CROToolkitPopup` removed but `primary_for_goal=true`. Cosmetic — no impact since status REMOVED.
- **G07 ❌ No conversion value model**: PPC_Wallace_40Miles last-30d shows 607 conv / $206 value. With Max-Conv-Value campaign `Search General` (no spend) there is intent to use value bidding but no real value-per-conversion-action mapping. Assign $200–500 per qualify_lead, $50–100 per call.

---

### 2. Wasted Spend (8 / 20)

**Top wasted spend (last 30d, zero conversions):**

| Search term | Cost | Clicks | Campaign |
|-------------|-----:|-------:|----------|
| jaguar f pace maintenance cost | $34.18 | 1 | JLR |
| tesla body shop near me | $24.78 | 2 | Tesla Approved |
| tesla dealership | $24.75 | 1 | Tesla Approved |
| tesla repair near me | $17.25 | 1 | Tesla Approved |
| range rover dealership near me | $17.13 | 1 | JLR |
| tesla bumper | $15.34 | 1 | Tesla Approved |
| tesla paint repair kit | $14.60 | 1 | Tesla Approved |
| tesla model 3 rear window replacement cost | $14.01 | 1 | Tesla Approved |
| tesla model y windshield replacement | $13.85 | 1 | Tesla Approved |
| tesla com service | $12.61 | 1 | Tesla Approved |
| tesla service | $11.99 | 1 | Tesla Approved |
| tesla website | $11.81 | 1 | Tesla Approved |
| tesla model y | $11.68 | 1 | Tesla Approved |
| tesla model 3 | $11.54 | 3 | Tesla Approved |
| land rover johnson city tn | $11.36 | 2 | JLR |
| distinct teslas | $11.35 | 1 | Tesla Approved |
| tesla ceramic coating | $10.34 | 1 | Tesla Approved |
| ... | | | |
| **Total wasted ≥$5 cost** | **~$540** | | |

50 search terms each ≥$5 cost / 0 conversions. ~16% of total spend wasted.

**Findings:**

- **G10 ❌ No negative-keyword shared set**: 0 negative-keyword shared sets detected via `campaign_criterion`. Each campaign maintains its own list, missing cross-campaign protection.
- **G11 ❌ Tesla generic terms not blocked**: `dealership`, `parts`, `tires`, `battery`, `windshield`, `service`, `website`, `extended warranty`, `model 3`, `model y`, `cybertruck`, `accessories`.
- **G12 ❌ JLR generic terms not blocked**: `dealership`, `maintenance cost`, `service coupons`, `vanden plas`, year-models (`2017`, `2023`).
- **G13 ⚠ Broad-match keywords without conversion-data backing**: top 25 spend kws are 100% BROAD. Without Smart Bidding rich-data signal, broad eats long-tail garbage.
- **G14 ✓ Negatives present**: 383 negative keywords across campaigns (PPC_Wallace_40Miles 93, Tesla 68, JLR 68, new Q2 campaigns 34–43 each). Decent baseline but coverage incomplete.

---

### 3. Account Structure (8 / 15)

**Active campaigns:**

| Campaign | Status | Type | Bidding | Budget/d | 30d Cost | Conv | CPA |
|----------|--------|------|---------|---------:|---------:|-----:|----:|
| PPC_Wallace_40Miles | PAUSED* | Search | MAX_CONV | $43 | $1,067 | 607 | $1.76 |
| Tesla Approved | PAUSED* | Search | MAX_CONV ($50 tCPA) | $30 | $1,261 | 29 | $43.48 |
| JLR Certified Collision Repairs | PAUSED* | Search | MAX_CONV ($52 tCPA) | $30 | $793 | 24 | $33.04 |
| Wallace Ford of Kingsport Brand | ENABLED | Smart | TARGET_SPEND | $9 | $264 | 84 | $3.15 |
| GOOG_WAL_SRCH_ToyotaCertified_2026Q2 | ENABLED | Search | TARGET_SPEND | $13 | $0 | 0 | — |
| GOOG_WAL_SRCH_JLRCertified_2026Q2 | ENABLED | Search | MANUAL_CPC | $30 | $0 | 0 | — |
| GOOG_WAL_SRCH_TeslaApproved_2026Q2 | ENABLED | Search | MANUAL_CPC | $30 | $0 | 0 | — |
| GOOG_WAL_SRCH_LocalCollision_2026Q2 | ENABLED | Search | MAX_CONV | $43 | $0 | 0 | — |
| GOOG_WAL_SRCH_Brand_2026Q2 | PAUSED | Search | TARGET_IMPRESSION_SHARE | $7 | $0 | 0 | — |
| BMW Certified | PAUSED | Search | MAX_CONV ($20 tCPA) | $14 | $0 | 0 | — |
| Rivian Approved | PAUSED | Search | MAX_CONV ($50 tCPA) | $14 | $0 | 0 | — |
| Search General | PAUSED | Search/DSA | MAX_CONV_VALUE | $10 | $0 | 0 | — |

*Status PAUSED but `serving_status=SERVING` and spend in window — paused mid-period or recently.

**Findings:**

- **G20 ❌ Two parallel campaign trees** running. Legacy campaigns (`PPC_Wallace_40Miles`, `Tesla Approved`, `JLR Certified Collision Repairs`, `BMW Certified`, `Rivian Approved`) coexist with new naming convention (`GOOG_WAL_SRCH_*_2026Q2`). Old campaigns paused but Tesla and JLR still spent within window — phased migration likely in progress.
- **G21 ❌ Inconsistent bidding strategy across new Q2 campaigns**: Toyota=TARGET_SPEND, JLR=MANUAL_CPC, Tesla=MANUAL_CPC, LocalCollision=MAX_CONV, Brand=TARGET_IMPRESSION_SHARE. Five different strategies for five similar campaigns. Standardize.
- **G22 ❌ Duplicate budgets**: 4 budget shells named "GOOG_WAL_SRCH_Brand_2026Q2" exist (1 active, 3 removed). Clean orphans (cosmetic).
- **G23 ✓ Single-keyword ad groups (SKAGs)**: each `Tesla Approved` ad group has one focused theme (`tesla repair`, `tesla body shop near`, etc.). Modern best practice is theme-grouped, not SKAG, but acceptable.
- **G24 ⚠ Smart campaign in account**: `Wallace Ford of Kingsport Brand` (Smart) — appears mis-scoped (Ford dealer vs collision center). $264/mo bleed.
- **G25 ❌ DSA campaign without spend**: `Search General` has dynamic ad group with $10/d budget, MAX_CONV_VALUE strategy, zero spend. Either kill or activate with proper page feeds.

---

### 4. Keywords (4 / 15)

**Keyword inventory:** 300 keywords across enabled+paused-non-removed campaigns.

- 224 keywords with **zero impressions** in last 30d (deadweight).
- 24 keywords with impressions but **zero clicks**.
- Top 25 spend keywords are **100% BROAD** match.

**Quality Score distribution (107 keywords with measurable QS):**

| QS | Count |
|----|-------|
| 1 | 27 |
| 2 | 30 |
| 3 | 34 |
| 4 | 8 |
| 5 | 8 |
| 6+ | **0** |

**Component breakdown** (top 25 spend keywords):

| Keyword | QS | Landing | Creative | CTR | Cost | Conv |
|---------|---:|---------|----------|-----|-----:|-----:|
| tesla repair shop | 3 | Below | Above | Below | $274 | 3 |
| tesla body shops | 3 | Below | Above | Below | $173 | 8 |
| tesla auto body shops near me | 2 | Below | Average | Below | $140 | 2 |
| auto body paint shop | 5 | Below | Above | Average | $134 | 83 |
| auto body repair and painting | 3 | Below | Above | Below | $122 | 70 |
| tesla repairs | 3 | Below | Above | Below | $121 | 3 |
| auto body repair | 3 | Below | Above | Below | $120 | 67 |
| tesla approved auto body shops | 3 | Below | Above | Below | $119 | 3 |
| tesla body repair | 3 | Below | Above | Below | $108 | 2 |
| body shop estimates | 3 | Below | Above | Below | $102 | 57 |
| tesla collision repair | 3 | Below | Above | Below | $95 | 1 |
| tesla certified shop | 2 | Below | Average | Below | $61 | 3 |
| paint body shop near me (PHRASE) | 1 | Below | Below | Below | $23 | 10 |

**Findings:**

- **G30 ❌ Landing page experience BELOW_AVERAGE on 95+ kws**. Single biggest QS lever. Audit landing pages — page speed, headline match, contact info above-the-fold, mobile UX. Mentioned in CLAUDE.md as `ops/wallace/fix_landing_page.py` script exists.
- **G31 ❌ Predicted CTR BELOW_AVERAGE on 95+ kws**. Tied to ad strength + relevance.
- **G32 ❌ No EXACT match on high-intent terms**. `body shop near me`, `auto body repair near me`, `collision repair near me` should run EXACT to lock CPC + signal.
- **G33 ❌ Conversions on Tesla broad kws don't match ad-group intent**. `tesla repair shop` BROAD pulls non-collision queries (parts, service, etc.) — see search term report.
- **G34 ⚠ `cpc_bid_micros=10000` ($0.01)** on most PPC_Wallace_40Miles ad groups. Overridden by Max-Conv strategy but signals bid neglect; if strategy ever falls back to manual, all ad groups stall.
- **G35 ⚠ Rivian ad groups bid $60 CPC** — extreme. Either intentional ceiling or oversight.

---

### 5. Ads (6 / 15)

**Ad strength distribution (62 ads, ENABLED non-removed):**

| Strength | Count |
|----------|------:|
| EXCELLENT | **0** |
| GOOD | 11 |
| AVERAGE | 18 |
| POOR | 4 |
| PENDING | 11 |
| UNSPECIFIED | 18 |

**Ad type mix:**
- RESPONSIVE_SEARCH_AD: 44
- CALL_AD: 16
- EXPANDED_DYNAMIC_SEARCH_AD: 1
- SMART_CAMPAIGN_AD: 1

**Findings:**

- **G40 ❌ Zero EXCELLENT ads**. Add headline/description variety, pin only critical assets, include keyword themes.
- **G41 ❌ POOR-strength ads serving with spend**: Range Rover Collision Repair ad ($24 cost). Rewrite immediately.
- **G42 ⚠ Most ad groups have only 1–2 ads** (target: 3 RSAs per ad group for asset diversity).
- **G43 ✓ Call ads present** (16). Good for mobile collision-repair calls.
- **G44 ❌ Tesla Approved ads all AVERAGE strength** despite high spend.
- **G45 ❌ Wallace_40Miles ads all AVERAGE**: top ad group `body shop` has AVERAGE-strength RSA with $488 cost on it.

---

### 6. Settings (6 / 10)

**Geo targeting:**

| Campaign | Geos |
|----------|------|
| Active legacy + Tesla + JLR + Rivian + BMW + PPC_Wallace_40Miles | TN (200531), VA (200567), KY (200573) — full state targeting |
| Wallace Ford Brand (Smart) | TN only |
| 2026Q2 Brand/LocalCollision | 40-mile proximity radius |
| 2026Q2 Toyota/Tesla/JLR | 75-mile proximity radius |
| Search General | VA, KY, US (?) |

**Findings:**

- **G50 ❌ Legacy campaigns target full TN+VA+KY**. Wallace Collision is in Bristol/Kingsport TN — full-state targeting wastes spend on far metros (Nashville, Memphis, Norfolk, Louisville). Proximity 40–60 miles is appropriate.
- **G51 ✓ New Q2 campaigns use proximity radii** (40/75 mi). Better. But 75-mile radius for OEM-certified probably justified (rarer service).
- **G52 ⚠ "Search General" targets KY/VA + GeoTarget 1025930** (unclear). Audit before re-enabling.
- **G53 ✓ Languages set on 6 campaigns** (assumed English-only).
- **G54 ⚠ 36 device criteria across account** — device bid modifiers exist. Verify mobile bid adjustment ≥0 for collision (high mobile-call intent).
- **G55 ✓ 5 user-interest criteria** — audience layering present.

---

## Cross-Platform Analysis

**Single-platform account (Google).** N/A for cross-platform allocation, tracking parity, creative parity, attribution overlap.

**Recommendation:** explore Meta Ads for top-of-funnel awareness in 40-mile radius (collision repair Pinterest/Facebook Lead Ads for insurance-claim moments). Microsoft Ads import (Bing has 6–9% query share in TN; auto-import would surface incremental conversions at lower CPC).

---

## Strategic Recommendations

1. **Consolidate to one campaign tree.** Either finish the 2026Q2 migration (turn off legacy, enable new) or revert. Two parallel trees confuse Smart Bidding and split budgets.
2. **Standardize bidding strategy.** Use MAX_CONV with portfolio tCPA across collision campaigns ($35 PPC_Wallace, $50 OEM). MANUAL_CPC and TARGET_SPEND are appropriate only for brand or DSA.
3. **Fix landing page experience first.** Single biggest QS lever (BELOW_AVERAGE on 95+ kws → 30–60% CPC penalty). Use `ops/wallace/fix_landing_page.py`.
4. **Clean conversion-action signal.** Drop `primary_for_goal` from Local Actions / Smart map / Smart ad CTC. Keep Form, Calls from ads, GA4 qualify_lead (and switch qualify_lead to ONE_PER_CLICK).
5. **Build shared negative-keyword list.** One master list applied to all OEM and collision campaigns covers ~$540/mo waste.
6. **Enable brand campaign.** Brand is dormant; competitors steal SERP.
7. **Pause Wallace Ford Smart campaign** unless it serves a different business unit you control.

---

## Scoring Detail

```
Aggregate = Google_Score × 1.0 (single platform)
         = 44

Google_Score = (Conv_25 × 0.25)+(Waste_8 × 0.20)+(Struct_8 × 0.15)
             + (KW_4 × 0.15)+(Ads_6 × 0.15)+(Set_6 × 0.10)

Wait — per-category scores already weighted:
  Conv 12/25 + Waste 8/20 + Struct 8/15 + KW 4/15 + Ads 6/15 + Set 6/10
  = 44/100
  Grade: D (40–59)
```

Targeting **75 / 100 (B)** within 90 days is realistic if landing pages fix, negatives consolidate, brand campaign activates, and conversion signal cleaned.
