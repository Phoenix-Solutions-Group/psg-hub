# Wallace Collision Center — Google Ads Audit (Fresh)
**Date:** 2026-05-19 | **Window:** LAST_30_DAYS (2026-04-19 → 2026-05-19) | **Customer ID:** 6048611995 | **MCC:** 6935795509

This is a re-pull 1 day after the 2026-05-18 audit, 6 days after the 2026Q2 swap was executed via `ops/wallace/launch_2026q2_swap.py` on 2026-05-13.

---

## Headline

**Google Ads Health Score: 35 / 100 — Grade F (Critical, regressed 3 pts from 38)**

The single dominant finding overrides everything below: **every responsive search ad in the enabled 2026Q2 campaigns is `ad_group_ad.status = PAUSED`.** The 2026-05-13 swap paused legacy campaigns and enabled Q2 campaigns + ad groups + keywords, but the RSAs were never unpaused. Result: the account has been functionally dark on collision-repair search for 6 days. Only `Wallace Ford of Kingsport Brand` (Smart campaign, $9/d) is currently serving ads.

| Category | Score | Bar | Weight | Δ vs 2026-05-18 |
|---|---|---|---|---|
| Conversion Tracking | 45 / 100 | █████░░░░░ | 25% | +6 |
| Wasted Spend / Negatives | 36 / 100 | ████░░░░░░ | 20% | +3 |
| Account Structure | 30 / 100 | ███░░░░░░░ | 15% | −8 |
| Keywords & Quality Score | 28 / 100 | ███░░░░░░░ | 15% | −3 |
| Ads & Assets | 30 / 100 | ███░░░░░░░ | 15% | −26 |
| Settings & Targeting | 39 / 100 | ████░░░░░░ | 10% | 0 |

Conversion Tracking improved because account-default `customer_conversion_goal` rows for `PAGE_VIEW / GET_DIRECTIONS / CONTACT / ENGAGEMENT / STORE_VISIT` from `GOOGLE_HOSTED` all show `biddable = false` (Smart Bidding will not optimize toward those goals regardless of `primary_for_goal` on individual `conversion_action` records). Either Layer 2 of `clean_smart_bidding_signal.py` was applied via the UI, the 5/18 audit misread the goal-biddability state, or Google's account defaults updated. Either way, current signal hygiene is materially better than the 5/18 read.

Ads & Assets collapsed because the Q2 cohort has zero active ads.

---

## What changed vs 2026-05-18

| Area | 2026-05-18 state | 2026-05-19 state | Source |
|---|---|---|---|
| Legacy campaigns | PAUSED (recent) | PAUSED, still serving 30d window | `campaign.status`, `change_event` 2026-05-13 |
| Q2 campaigns | ENABLED, 0 impressions | ENABLED, 0 impressions | `metrics.impressions = 0` |
| Q2 RSAs | not pulled in 5/18 audit | **all PAUSED** (`ad_group_ad.status = PAUSED`) — 11 of 11 | `ad_group_ad` |
| Q2 keywords | 67 enabled, all 0-imp | 67 enabled, all 0-imp | `ad_group_criterion` |
| Q2 ad groups | enabled | enabled (1 each per ad group) | `ad_group.status = ENABLED` |
| Brand Q2 campaign | PAUSED, $7/d, TARGET_IMPRESSION_SHARE | unchanged | `campaign` |
| `qualify_lead` (7194760257) counting | MANY_PER_CLICK | unchanged | `conversion_action` |
| `Smart campaign ad clicks to call` (7258748379) | included in conv metric | unchanged (still `include_in_conversions_metric = true`) | `conversion_action` |
| GBP engagement goals biddability | thought to be biddable | **`biddable = false`** for 5 categories from `GOOGLE_HOSTED` | `customer_conversion_goal` |
| Negative shared lists | none (only `Porsche` BRANDS list, 0 refs) | unchanged | `shared_set` (inferred) |

The only on-platform change in the last 14 days is the 2026-05-13 swap (visible in `change_event`, user `nick@phoenixsolutionsgroup.net`, client `GOOGLE_ADS_API`). The three other scripts in `ops/wallace/` (`add_oem_negatives.py`, `clean_smart_bidding_signal.py`, `enable_brand_campaign.py`) are present in the repo but show no `execute` row in `/Users/schoolcraft_mbpro/apps/ads/logs/` and no corresponding `change_event` activity.

---

## Account Snapshot (LAST_30_DAYS)

Spend totals are from a window that mostly predates the 2026-05-13 swap, so they reflect legacy delivery, not current state.

| Metric | Value | Note |
|---|---|---|
| Total spend (non-removed) | $3,293.86 | $3,026.35 on now-paused legacy + $267.51 Ford Brand Smart |
| Currently delivering | $267.51 / 30d | **only** Wallace Ford of Kingsport Brand (Smart) |
| Optimization score | 61.7% | down from 62.7% on 5/18 |
| Auto-tagging | ON ✓ | |
| Enhanced conv for leads | enabled ✓ | |
| Conversion tracking | self-managed ✓ | |
| Customer data terms | accepted ✓ | |

### Per-campaign 30d delivery

| Campaign | Status | Budget | Spend | Imps | Clicks | Conv | Note |
|---|---|---|---|---|---|---|---|
| Tesla Approved | PAUSED | $30/d | $1,215.03 | 4,362 | 179 | 29 | paused 2026-05-13 |
| PPC_Wallace_40Miles | PAUSED | $43/d | $1,037.60 | 12,464 | 627 | 594 | paused 2026-05-13; 594 conv is mostly GBP soft events historically |
| JLR Certified Collision Repairs | PAUSED | $30/d | $773.72 | 2,309 | 90 | 20 | paused 2026-05-13 |
| Wallace Ford of Kingsport Brand | ENABLED | $9/d | $267.51 | 10,434 | 927 | 89 | **only campaign currently serving** |
| GOOG_WAL_SRCH_LocalCollision_2026Q2 | ENABLED | $43/d | $0 | 0 | 0 | 0 | 5 ad groups, all RSAs PAUSED |
| GOOG_WAL_SRCH_TeslaApproved_2026Q2 | ENABLED | $30/d | $0 | 0 | 0 | 0 | 1 ad group, RSA PAUSED |
| GOOG_WAL_SRCH_JLRCertified_2026Q2 | ENABLED | $30/d | $0 | 0 | 0 | 0 | 1 ad group, RSA PAUSED |
| GOOG_WAL_SRCH_ToyotaCertified_2026Q2 | ENABLED | $13/d | $0 | 0 | 0 | 0 | 3 ad groups, no enabled RSAs detected |
| GOOG_WAL_SRCH_Brand_2026Q2 | PAUSED | $7/d | $0 | 0 | 0 | 0 | 5 brand keywords loaded, RSA PAUSED, campaign PAUSED |
| BMW Certified | PAUSED | $14/d | $0 | 0 | 0 | 0 | |
| Rivian Approved | PAUSED | $14/d | $0 | 0 | 0 | 0 | |
| Search General | PAUSED | $10/d | $0 | 0 | 0 | 0 | still has Display Network on |

Daily budgets currently allocated to **enabled** campaigns total $125/d, but only $9/d (Ford Brand) is actually delivering. Daily underspend is approximately **$116/d** since 2026-05-13 ≈ **$696 of unspent budget capacity** over the 6 days the swap has been in this stalled state.

---

## Top Quick Wins (do these today)

| # | Severity | Issue | Fix | Time | Impact |
|---|---|---|---|---|---|
| 1 | **CRITICAL** | All 11 Q2 RSAs are `ad_group_ad.status = PAUSED`. Q2 campaigns + ad groups + keywords are enabled, but no ads serve. | Set `ad_group_ad.status = ENABLED` on every RSA in `GOOG_WAL_SRCH_LocalCollision_2026Q2`, `_TeslaApproved_2026Q2`, `_JLRCertified_2026Q2`, `_ToyotaCertified_2026Q2`, and (after step 2) `_Brand_2026Q2`. | 5 min | Restores ~$116/d of delivery capacity |
| 2 | **CRITICAL** | `GOOG_WAL_SRCH_Brand_2026Q2` is PAUSED. Brand defense is dark. | Run `ops/wallace/enable_brand_campaign.py --execute`. Script is built and tested in dry-run. | 1 min | Recover 20–40 brand conv/mo at ~$3 CPA |
| 3 | High | `qualify_lead` (7194760257) still `counting_type = MANY_PER_CLICK`; `Smart campaign ad clicks to call` (7258748379) still `include_in_conversions_metric = true`. | Run `ops/wallace/clean_smart_bidding_signal.py --execute`. Layer-2 goal demotions are mostly no-ops (already biddable=false), but Layer-1 conversion-action edits still need to apply. | 1 min | Cuts lead-event inflation; isolates Smart-call signal from Search bidder |
| 4 | High | No shared negative lists; the same Tesla/JLR informational queries that wasted $278 in the 30d window before the pause will re-fire when Q2 RSAs go live unless negatives are in place. | Run `ops/wallace/add_oem_negatives.py --execute` to push ~46 PHRASE negatives into the 7 target campaigns. | 2 min | Pre-block ~$540/mo of forecasted waste once Q2 starts serving |
| 5 | High | Legacy `Tesla Approved`, `JLR Certified Collision Repairs`, `Rivian Approved`, `Search General` are still `positive_geo_target_type = PRESENCE_OR_INTEREST`. | Change to `PRESENCE` on all four. Even though they are paused, this prevents the bug from re-emerging on reactivation. | 5 min | Setting hygiene |
| 6 | High | `Search General` has `target_content_network = true` (Display on a Search campaign). | Set `target_content_network = false`. | 1 min | Setting hygiene |
| 7 | Medium | `Wallace Ford of Kingsport Brand` Smart campaign (Ford dealership, $267/mo) runs inside the *collision center* customer ID. Confirmed not a typo per `enable_brand_campaign.py` comment ("Wallace Ford of Kingsport Brand (22896707513) is intentionally excluded"). | Confirm with client whether to keep, migrate to a separate CID, or pause. | client check | $267/mo + signal hygiene if mis-scoped |
| 8 | Medium | Q2 `LocalCollision` uses `MAXIMIZE_CONVERSIONS` with no recent conversion history (the new campaign has 0 conv). Will enter Smart Bidding learning the moment ads enable. | Drop to `MANUAL_CPC` for first 14 days, or accept the learning-phase volatility. Plan a switch to `MAXIMIZE_CONVERSIONS` with `tCPA $35` once 30 conv accrued. | 5 min | Avoid CPA spikes during cold start |

---

## Findings by Category

### 1. Conversion Tracking (25% weight) — 45 / 100

| ID | Result | Evidence |
|---|---|---|
| G42 | **WARNING** | 8 of 14 ENABLED conversion actions have `primary_for_goal = true`, but goal-level biddability protects most of them. Net optimization signal is now narrower than the per-action flag suggests. |
| G43 | **PASS** | `enhanced_conversions_for_leads_enabled = true` at customer level. |
| G44 | **UNKNOWN (G-SYS1)** | Server-side / CAPI not derivable from API. Default WARN. |
| G45 | **UNKNOWN (G-SYS1)** | Consent Mode v2 mode not in API. Default WARN. US-only account, lower EEA exposure. |
| G46 | **WARNING** | 7d–90d click-through windows mixed by action. `Calls from ads` and `Smart campaign ad clicks to call` use 30d view-through — aggressive. |
| G47 | **PARTIAL FAIL** | Engagement actions (`Local actions - Directions/Website visits/Other engagements/Menu views`, `Smart campaign map clicks to call`, `Smart campaign map directions`) still have `primary_for_goal = true` and value=1, but **all show `include_in_conversions_metric = false`** in this pull (different from 5/18 read). However `Smart campaign ad clicks to call` (7258748379) and `qualify_lead` (7194760257) both still `include_in_conversions_metric = true` and remain in the Smart Bidding signal. |
| G-CCG1 | **PASS** | `customer_conversion_goal` rows show `biddable = false` for `PAGE_VIEW/GET_DIRECTIONS/CONTACT-GOOGLE_HOSTED/ENGAGEMENT/STORE_VISIT/CONTACT-UNKNOWN/ENGAGEMENT-UNKNOWN`. `SUBMIT_LEAD_FORM/WEBSITE` and `PHONE_CALL_LEAD/CALL_FROM_ADS` and `CONTACT/CALL_FROM_ADS` are biddable. This is the correct configuration for a collision shop. |
| G48 | **WARNING** | Attribution mix: 8 actions on `GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN` (Form, qualify_lead, GA4, Calls from ads, Calls from Smart Campaign Ads); 7 on `GOOGLE_ADS_LAST_CLICK` (GBP local actions, Smart map/ad-to-call); Store visits UNKNOWN. |
| G49 | **WARNING** | `Form` and `Calls from ads` and engagement actions all default_value = 0 or 1. No dynamic value rules. |
| G-CT1 | **FAIL** | Double-count risk remaining for Smart-campaign calls: `Calls from Smart Campaign Ads` (7258584434, ONE_PER_CLICK, in metric) AND `Smart campaign ad clicks to call` (7258748379, MANY_PER_CLICK, in metric) both fire on Smart Campaign Ad click-to-call. |
| G-CT2 | **UNKNOWN** | GA4 link status not exposed; 7 GA4-typed conversion actions present (5 HIDDEN, 2 ENABLED) → strong inference link exists. WARN. |
| G-CT3 | **UNKNOWN** | gtag firing requires site crawl. WARN. |
| G-CTV1 | **N/A** | No CTV/Video. |

### 2. Wasted Spend / Negatives (20% weight) — 36 / 100

| ID | Result | Evidence |
|---|---|---|
| G13 | **FAIL** | `change_event` LAST_14_DAYS shows 51 events, all from the 2026-05-06 (campaign creation) and 2026-05-13 (swap) batches. **No negative-keyword or search-term review activity** in the window. |
| G14 | **FAIL** | No `shared_set` of type `NEGATIVE_KEYWORDS` referenced by any campaign. Only the legacy `Porsche` BRANDS list (0 refs). |
| G15 | **WARNING** | Per-campaign negatives present and meaningful in non-Brand campaigns (PPC_Wallace_40Miles 93, JLR Legacy 68, Tesla Legacy 68, TeslaApproved_2026Q2 43, ToyotaCertified_2026Q2 38, JLRCertified_2026Q2 36, LocalCollision_2026Q2 34). Brand_2026Q2 negatives unknown from this pull. |
| G16 | **FAIL** | 22.4% of search-term-attributable spend in the window still flows to terms with >$5 cost & 0 conv. Top wasted terms in the new pull (>$10 each, 0 conv): `jaguar f pace maintenance cost` $34.18, `tesla body shop near me` $24.78, `tesla dealership` $24.75, `tesla repair near me` $17.25, `range rover dealership near me` $17.13, `tesla bumper` $15.34, `tesla paint repair kit` $14.60, `tesla model y windshield replacement` $13.85, `tesla com service` $12.61, `tesla service` $11.99, `tesla website` $11.81, `tesla model y` $11.68, `tesla model 3` $11.54, `land rover johnson city tn` $11.36, `distinct teslas` $11.35, `tesla ceramic coating` $10.34, `model y tesla rims` $10.12. Note `cybertruck body parts` $14.53 with 3 conv (likely GBP-soft) — treat with skepticism. |
| G17 | **PASS (with caveat)** | 0 BROAD + MANUAL_CPC combinations. The two MANUAL_CPC Q2 campaigns (`_JLRCertified_2026Q2`, `_TeslaApproved_2026Q2`) currently have PHRASE + EXACT keywords only. |
| G18 | **WARNING** | Same close-variant leakage pattern as 5/18; will reappear when Q2 RSAs unpause unless negatives are in place. |
| G19 | **PASS** | Search-term visibility within expected band for the search portion of spend. |
| G-WS1 | **PASS** | 0 keywords with >100 clicks AND 0 conversions in 30d. |

### 3. Account Structure (15% weight) — 30 / 100

| ID | Result | Evidence |
|---|---|---|
| G01 | **WARNING** | Naming conventions remain split: legacy free-form vs. `GOOG_WAL_SRCH_<Theme>_2026Q2`. |
| G02 | **FAIL** | Ad-group naming inconsistent across the Q2 cohort (Title Case "Tesla Approved Collision", "Brand Terms", "Collision Repair") vs. legacy lowercase ("body shop near", "collision repair near"). |
| G03 | **PASS** | Q2 ad groups carry 5–9 keywords each — within single-theme guideline. |
| G04 | **WARNING** | 11 non-removed campaigns: 6 PAUSED legacy + 5 ENABLED Q2 + 1 ENABLED Smart + Brand_Q2 PAUSED. Parallel structure during stalled cutover. |
| G05 | **FAIL** | `GOOG_WAL_SRCH_Brand_2026Q2` is PAUSED and its only RSA is also PAUSED. The Wallace Collision Center brand is **undefended** on Search; the only "brand" coverage is the Ford dealership Smart campaign on a different business. |
| G06 | **FAIL** | 0 Performance Max campaigns despite eligibility (account historically generates 700+ conv/mo through legacy + GBP). |
| G07 | **N/A** | No PMax to require brand exclusions. |
| G08 | **FAIL** | Spend is decoupled from performance: the historical top performer (PPC_Wallace_40Miles, 594 conv/30d) is paused. Its replacement (`LocalCollision_2026Q2`) is enabled with $43/d budget but has $0 delivery. |
| G09 | **N/A** | Budget-lost impression share moot while campaigns are paused. Legacy values for the lookback: Tesla 53.97% lost, JLR 67.36% lost. Will re-apply if anything is re-enabled at current budgets. |
| G10 | **UNKNOWN (G-SYS1)** | No `AD_SCHEDULE` rows in `campaign_criterion`. WARN. |
| G11 | **FAIL** | Legacy `Search General`, `Tesla Approved`, `JLR Certified Collision Repairs`, `Rivian Approved` all still `positive_geo_target_type = PRESENCE_OR_INTEREST`. Q2 campaigns correctly `PRESENCE`. |
| G12 | **FAIL** | `Search General` (PAUSED) still has `target_content_network = true` and `target_search_network = true`; Tesla / JLR / Rivian / BMW legacy still have `target_search_network = true` (Google search partners). Q2 campaigns correctly Google Search only. |
| G-AS1 | **FAIL** (new) | Q2 ad-group ads are all PAUSED — every single RSA in `LocalCollision_2026Q2` (5), `TeslaApproved_2026Q2` (1), `JLRCertified_2026Q2` (1), `ToyotaCertified_2026Q2` (3), `Brand_2026Q2` (1) is `ad_group_ad.status = PAUSED`. **Account is structurally dark on collision search.** |

### 4. Keywords & Quality Score (15% weight) — 28 / 100

Note: QS only computes on keywords with impressions. Q2 cohort has zero impressions, so 67 enabled Q2 keywords have `quality_score = 0` and `creative_quality_score / post_click_quality_score / search_predicted_ctr = UNSPECIFIED`. Numbers below are for the ~109 keywords with impressions in the lookback window (almost entirely legacy).

| ID | Result | Evidence |
|---|---|---|
| G20 | **FAIL** | Of 109 rated keywords: QS5=10, QS4=4, QS3=43, QS2=37, QS1=8, QS0=7. Impression-weighted account QS sits between 2 and 3. |
| G21 | **FAIL** | 88 of 102 rated keywords (86%) have QS ≤ 3. |
| G22 | **FAIL** | 96 of 102 rated keywords (94%) have `search_predicted_ctr = BELOW_AVERAGE`. |
| G23 | **WARNING** | Creative quality split: 41 ABOVE_AVERAGE, 32 AVERAGE, 29 BELOW_AVERAGE. |
| G24 | **FAIL** | 95 of 102 rated keywords (93%) have `post_click_quality_score = BELOW_AVERAGE`. Landing-page experience remains the single biggest QS lever. |
| G25 | **FAIL** | Top 10 spend keywords this window: QS values 0, 0, 3, 3, 2, 5, 3, 3, 3, 3. Only one ≥5; none ≥7. |
| G-KW1 | **FAIL** | 67 of 332 unique keywords (20.2%) have 0 impressions in 30d. All sit in the Q2 cohort — direct consequence of the paused RSAs. |
| G-KW2 | **PASS** | RSA headlines (legacy) mirror ad-group themes. |

### 5. Ads & Assets (15% weight) — 30 / 100

| ID | Result | Evidence |
|---|---|---|
| G26 | **PASS** | 44 RSAs across legacy ad groups; 11 RSAs across Q2 ad groups. |
| G27 | **PASS** | RSAs have ≥3 headlines. |
| G28 | **PASS** | RSAs have ≥2 descriptions. |
| G29 | **PENDING / WARN** | All 11 Q2 RSAs report `ad_strength = PENDING` (no served impressions yet). Will not rate until they go live. |
| G-AD0 | **CRITICAL FAIL** (new) | Every Q2 RSA is `ad_group_ad.status = PAUSED`. The 5/13 swap enabled campaigns and ad groups but left ads paused. |
| G30 | **UNKNOWN (G-SYS1)** | Headline pin map not pulled. |
| G31–G34 | **N/A** | No PMax. |
| G35 | **PASS** | Legacy RSA copy is keyword-relevant. Q2 RSAs not yet rated. |
| G-AD2 | **PASS** | Account-wide CTR 6.18% beats local-services benchmark (heavily Ford-Brand-weighted). |
| G-AI1 | **FAIL** | AI Max for Search blocked by G14 (no shared negative lists) and G-AD0 (no enabled ads). |
| G-DG1 → G-DG3 | **N/A** | No Demand Gen / Video. |

### 6. Settings & Targeting (10% weight) — 39 / 100

| ID | Result | Evidence |
|---|---|---|
| G50 | **WARNING** | Account-level sitelinks inherited; no campaign-specific sitelinks on Q2 campaigns (same as 5/18). |
| G51 / G52 | **PASS** | Callouts and structured snippets attached at account level. |
| G53 | **WARNING** | One BUSINESS_LOGO image asset surfaced; no IMAGE extensions on the enabled-cohort campaigns. |
| G54 | **FAIL** | Four phone numbers on CALL assets (per 5/18 pull). Not re-validated this run but no `change_event` activity on `asset` rows. |
| G55 | **FAIL** | No Lead Form extension assets detected. |
| G56 | **WARNING** | Only legacy `Search General` carries USER_INTEREST audience criteria; Q2 cohort has none. |
| G57 | **FAIL** | No `customer.user_list` criteria. |
| G58 | **FAIL** | No customer-level placement exclusions. |
| G59 | **UNKNOWN** | Mobile LCP requires PSI run. G24 implies likely FAIL. |
| G60 | **PASS** | Final URLs are theme-matched and UTM'd. |
| G61 | **UNKNOWN** | Schema markup needs site crawl. |
| G36 | **WARNING** | Bidding strategies still mixed: legacy `MAXIMIZE_CONVERSIONS` / `MAXIMIZE_CONVERSION_VALUE` / `MANUAL_CPC` / `TARGET_IMPRESSION_SHARE` / `TARGET_SPEND`. |
| G37 | **WARNING** | All Smart-Bidding campaigns: `target_cpa_micros = 0`, `target_roas = 0`. No explicit guardrails. |
| G38 | **UNKNOWN** | Learning-phase status not pulled. |
| G39 | **N/A while paused** | Legacy budget loss documented; will re-apply if reactivated at current budgets. |
| G40 | **PASS** | MANUAL_CPC used appropriately on cold-start Q2 campaigns. |
| G41 | **WARNING** | No portfolio bid strategies. |

---

## G-SYS1 (data quality)

| Source | Status | Affected | Mitigation |
|---|---|---|---|
| `change_event` LAST_14_DAYS | returned 50 rows, no negative-keyword or asset edits | G13 | Confirmed FAIL |
| GA4 link status | not exposed in API | G-CT2 | UI check needed |
| Consent Mode v2 mode | not exposed | G45 | UI / site team check |
| Server-side / CAPI | not derivable | G44 | Site team check |
| `ad_schedule` | no AD_SCHEDULE in `campaign_criterion` | G10 | UI check |
| Mobile LCP / schema | site crawl required | G59, G61 | Out of scope |
| Headline pins | not pulled | G30 | UI sample |

---

## Recommended remediation sequence

### Today (≤15 min total)

1. **Unpause Q2 RSAs** — write `ops/wallace/unpause_q2_ads.py` (mirror pattern of `launch_2026q2_swap.py`) to set `ad_group_ad.status = ENABLED` on the 11 RSAs in `LocalCollision_2026Q2` (5), `TeslaApproved_2026Q2` (1), `JLRCertified_2026Q2` (1), `ToyotaCertified_2026Q2` (3), and `Brand_2026Q2` (1). Dry-run first; verify ad count; execute.
2. `python -m ops.wallace.enable_brand_campaign --execute` — pre-built; flips `Brand_2026Q2` ENABLED with brand keywords already loaded, raises budget $7 → $15, switches bidding to TARGET_SPEND at $1.50 ceiling.
3. `python -m ops.wallace.add_oem_negatives --execute` — pre-built; pushes 46 PHRASE negatives across the 7 OEM-themed campaigns before any of them resume traffic.
4. `python -m ops.wallace.clean_smart_bidding_signal --execute` — pre-built; flips `qualify_lead` to ONE_PER_CLICK and removes `Smart campaign ad clicks to call` from the conversions metric.

### Within 7 days

5. Build geo-fix op script: switch `positive_geo_target_type` from `PRESENCE_OR_INTEREST` to `PRESENCE` on the four legacy campaigns (Search General, Tesla Approved, JLR, Rivian) and set `target_content_network = false` / `target_search_network = false` on Search General. Even though the campaigns are paused, this prevents re-introduction of the bug if reactivated.
6. Pause or fully remove `Search General` if not part of the future plan — it carries DSA, $10/d budget, and the wrong network settings.
7. Verify with client whether `Wallace Ford of Kingsport Brand` Smart campaign should continue running in this CID.
8. Once Q2 RSAs accumulate 7d of impressions, re-audit ad strength and pin the top headline / second headline on each RSA (Wallace Collision Center / theme-specific hook).

### Within 30 days

9. Build 3 themed shared negative-keyword lists (Competitor / Jobs+Free / Tesla-Parts+Service) and attach to all Q2 Search campaigns. Migrate the per-campaign negatives onto the shared lists.
10. Move `JLRCertified_2026Q2` and `TeslaApproved_2026Q2` from MANUAL_CPC to MAXIMIZE_CONVERSIONS once each accrues ≥15 conv/mo.
11. PMax pilot — only after (a) negative lists deployed, (b) brand exclusions configured, (c) `qualify_lead` and call double-count fixed. Target $40–60/d, square + 9:16 video assets.
12. Landing-page LCP brief to site team for `/tesla-approved-body-shop-repair/`, `/bmw-certified-collision-repair-center/`, `/jaguar-land-rover-certified/`, `/toyota-certified/`, `/repair-estimate/`. G24 (93% BELOW_AVERAGE) is the largest QS lever.

---

## Wasted spend forecast (post-relaunch)

If Q2 RSAs go live without the negative-list deployment in step 3 above, the same OEM-informational queries from the 30d lookback will hit the new MANUAL_CPC Tesla and JLR campaigns at higher CPC and worse landing-page experience. Forecast:

| Term cluster | 30d historical waste | Forecast next 30d if no negatives |
|---|---|---|
| Tesla informational / dealer / parts / service | $215 | $260 |
| JLR / Range Rover informational | $73 | $90 |
| Toyota dealer conquest (`toyota of kingsport collision` etc.) | $0 (Q2 not live yet) | $30 (untested intent) |
| **Total** | **$288** | **~$380** |

Running `add_oem_negatives.py --execute` before unpause is mandatory.

---

## Score math

```
S_total = Σ(C_pass × W_sev × W_cat) / Σ(C_total × W_sev × W_cat) × 100
       = 0.25 × 45 + 0.20 × 36 + 0.15 × 30 + 0.15 × 28 + 0.15 × 30 + 0.10 × 39
       = 11.25 + 7.20 + 4.50 + 4.20 + 4.50 + 3.90
       = 35.55 → 35
```

Largest single drag: paused Q2 RSAs (G-AD0) and the resulting structural failure (G-AS1, G05, G08, G-KW1). Once steps 1–4 above are executed, score is projected to climb to the 55–60 range in 7 days as ads serve and conversion-signal hygiene takes effect.

---

*Audit produced via `mcp__google-ads-mcp__search` against Google Ads API v20 on 2026-05-19. Authoritative for the state of `customers/6048611995` at fetch time.*
