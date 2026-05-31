# Wallace Collision Center — Google Ads Audit
**Date:** 2026-05-18 | **Window:** LAST_30_DAYS (2026-04-18 → 2026-05-18) | **Customer ID:** 6048611995 | **MCC:** 6935795509 (Phoenix Solutions Group)

---

## Health Score

**Google Ads Health Score: 38 / 100 — Grade F (Critical)**

| Category | Score | Bar | Weight |
|---|---|---|---|
| Conversion Tracking | 39 / 100 | ████░░░░░░ | 25% |
| Wasted Spend / Negatives | 33 / 100 | ███░░░░░░░ | 20% |
| Account Structure | 38 / 100 | ████░░░░░░ | 15% |
| Keywords & Quality Score | 31 / 100 | ███░░░░░░░ | 15% |
| Ads & Assets | 56 / 100 | ██████░░░░ | 15% |
| Settings & Targeting | 39 / 100 | ████░░░░░░ | 10% |

**Math (weighted scoring per `scoring-system.md`):**
`S_total = Σ(C_pass × W_sev × W_cat) / Σ(C_total × W_sev × W_cat) × 100`
- Earned points: 90.4
- Max possible (N/A excluded): 234.0
- 90.4 / 234.0 × 100 = **38.6 → 38**

Category contribution breakdown:
- Conversion Tracking: 18.4 earned / 47.5 possible × 25 = 9.7
- Wasted Spend: 13.5 / 41.0 × 20 = 6.6
- Account Structure: 11.4 / 30.0 × 15 = 5.7
- Keywords & QS: 7.6 / 24.5 × 15 = 4.7
- Ads & Assets: 25.5 / 45.5 × 15 = 8.4
- Settings & Targeting: 14.0 / 35.5 × 10 = 3.9
- **Total ≈ 38 → Grade F**

---

## Account Snapshot

| Metric | Value (LAST_30_DAYS) |
|---|---|
| Total spend (all non-removed campaigns) | **$3,384.77** |
| Spend on PAUSED legacy campaigns | $3,120.38 (92.2% of spend) |
| Spend on ENABLED campaigns | $264.39 (7.8% — all Smart Brand) |
| Impressions | 30,309 |
| Clicks | 1,872 |
| Account CTR | 6.18% |
| Account CVR | 39.77% (heavily inflated — see G47/G-CT1) |
| Account CPA | $4.55 (mostly soft GBP conversions) |
| Account CPC | $1.81 |
| Currency / TZ | USD / America/Chicago |
| Auto-tagging | ON ✓ |
| Optimization score | 62.7% |
| Conversion tracking mode | Self-managed ✓ |
| Customer Data Terms accepted | true ✓ |
| Enhanced conversions for leads | enabled ✓ |

**Account composition:**
- 12 campaigns total (6 PAUSED, 6 ENABLED; of the 6 ENABLED, 5 = new "2026Q2" cohort with **0 impressions in 30d**; 1 = Smart "Wallace Ford of Kingsport Brand")
- 42 ad groups total, ~21 ENABLED in ENABLED campaigns (most in 2026Q2 cohort with 0 impressions)
- **332 unique keywords** (dedup'd by ad_group + text + match_type); 67 in ENABLED campaigns (all zero-impression), 265 in PAUSED campaigns
- Match-type mix: 159 BROAD / 144 PHRASE / 29 EXACT
- 62 ads (44 RSA, 16 CALL_AD, 1 ETA-style dynamic search, 1 SMART_CAMPAIGN_AD)
- 21 conversion actions defined (5 HIDDEN, 2 REMOVED, 14 ENABLED)
- 1 shared set ("Porsche", BRANDS type, 0 references — effectively unused)
- 0 PMax campaigns, 0 Demand Gen, 0 Video, 0 PMax asset groups

**Critical structural anomaly:** the account is currently in a **transition state**. Most spend (92%) is flowing through PAUSED legacy campaigns (PPC_Wallace_40Miles, Tesla Approved, JLR Certified Collision Repairs) — but the API shows their `serving_status = SERVING` and 30-day metrics are non-zero, which means they were active for most of the lookback window and were paused recently (likely as part of the 2026Q2 cutover). The new 2026Q2 GOOG_WAL_SRCH_* campaigns are ENABLED but have **zero impressions**, indicating the cutover stalled — ad copy/keywords/extensions may not yet be live, or the Brand campaign (which was used to anchor brand bidding) is PAUSED.

---

## Quick Wins (sorted by severity × impact)

| # | Check | Issue | Fix | Time | Est. Impact |
|---|---|---|---|---|---|
| 1 | G05 / structure | 2026Q2 Brand campaign PAUSED while 4 non-brand Q2 campaigns ENABLED; account is dark on brand defence | Enable `GOOG_WAL_SRCH_Brand_2026Q2` or copy negatives into a quick exact-match brand campaign | 10 min | High — recovers brand impressions immediately |
| 2 | G47 / G-CT1 | 6 GBP `Local actions - *` conversions counted as Primary across multiple Smart conv actions; CVR shows 39.77% because directions/website-clicks/menu-views/other-engagements are counted as conversions | Demote `Local actions - Directions/Website visits/Other engagements/Menu views` to Secondary (and drop from "Include in conversions"); keep only Form, Calls from ads, qualify_lead, and Calls from Smart Ads as Primary | 5 min | Critical — fixes Smart Bidding signal for the new 2026Q2 stack |
| 3 | G14 / G15 | No Shared Negative Keyword Lists in use (the only existing Shared Set is `Porsche` BRANDS list with 0 references) | Create 3 themed lists (Competitor, Jobs, Free, Irrelevant) and attach to all enabled Search campaigns | 15 min | Critical — needed before AI Max or Smart Bidding on new Q2 stack |
| 4 | G16 | 22.4% of search-term spend goes to terms with >$10 cost & 0 conversions; almost all are Tesla "model X", "service", "website", "dealership" intent queries | Add negatives: `dealership`, `service`, `model 3`, `model y`, `website`, `paint repair kit`, `windshield replacement`, `johnson city` to Tesla & JLR campaigns | 10 min | High — recovers ~$280 / mo |
| 5 | G12 | "Search General" (paused) has Display Network ON; the Smart Brand campaign also serves Display by design — non-issue, but Search General is a misconfiguration if reactivated | Confirm Search General stays paused or disable Display before reactivating | 2 min | Medium |
| 6 | G29 | 4 RSAs with POOR ad strength, 18 AVERAGE | Add 3–5 more keyword-rich headlines to each POOR/AVERAGE RSA; aim for 12–15 unique headlines | 30 min | High |
| 7 | G50 | 5 of the 6 ENABLED 2026Q2 campaigns have no campaign-level sitelinks (rely on account-level only) | Add 4+ vehicle-make-specific sitelinks per Q2 campaign | 15 min | Medium |
| 8 | G54 | Account uses 4 different phone numbers across CALL assets ((423) 652-2233, 423-454-4292, 423-397-4042, (423) 578-3600) with no clear call tracking strategy | Consolidate on one number with call tracking + verify "Calls from ads" still attributes | 10 min | High |
| 9 | G-PM6 / G06 | No PMax campaigns despite ~745 conversions/mo (sufficient volume) | Test PMax with brand exclusions configured upfront | 60 min build | High over 30d |
| 10 | G45 | Consent Mode v2 status not visible in API; presume Basic only | Verify Advanced Consent Mode v2 with site team | 15 min | Critical for EEA but US-focused so lower impact here |

---

## Findings by Category

### 1. Conversion Tracking (25% weight) — 39 / 100

| ID | Result | Evidence |
|---|---|---|
| G42 | **WARNING** | 14 ENABLED conversion actions exist, 8 marked `primary_for_goal=true`. Excessive primary count; Smart Bidding signal will be diluted. |
| G43 | **PASS** | `enhanced_conversions_for_leads_enabled = true` at customer setting level. Verified status per-conversion not exposed via API. |
| G44 | **UNKNOWN (G-SYS1)** | Server-side tracking presence cannot be derived from API alone. Document with site team. Default to WARNING for scoring. |
| G45 | **UNKNOWN (G-SYS1)** | Consent Mode v2 mode (Basic vs Advanced) is not surfaced in API. Scored as WARNING. Account is US-only, lower EEA exposure. |
| G46 | **WARNING** | Form/qualify_lead use 90d click-through window (appropriate for collision lead funnel). Call & GBP actions use 30d. OK overall but click-through-30d on phone-call ad action (id 565570527) is fine; view-through 30d is aggressive. |
| G47 | **FAIL** | 8 actions flagged Primary including 5 micro events: `Local actions - Directions`, `Local actions - Website visits`, `Local actions - Other engagements`, `Local actions - Menu views`, `Smart campaign map directions`, `Smart campaign ad clicks to call`. These inflate the conversion count and confuse Smart Bidding when the 2026Q2 stack ramps up. |
| G48 | **WARNING** | Mix: 7 actions on `GOOGLE_ADS_LAST_CLICK`, 7 on `GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN`, 1 UNKNOWN (Store visits — Google-managed). Per smart-campaign exclusion rule, the SMART_CAMPAIGN_* actions are not counted as remediable. Recommend DDA where DDA model is `AVAILABLE` for the four GBP `Local actions - *` actions (currently Last Click). |
| G49 | **WARNING** | Form, qualify_lead, Calls from ads all use `default_value = 1` (or 0 for Form). No dynamic lead-score value rules. Reasonable for early-stage but missing optimization lever. |
| G-CT1 | **FAIL** | Likely double-counting on calls: `Calls from ads` (id 565570527, type AD_CALL, Primary, included in conv metric) AND `Calls from Smart Campaign Ads` (id 7258584434, Primary, included) AND `Smart campaign ad clicks to call` (id 7258748379, Primary, included). For a single click-to-call event the Smart campaign can count up to 3 conversion actions. The Smart-campaign-managed actions are excluded from the double-count rule for the Smart campaign itself, but `Calls from ads` is advertiser-managed and overlaps the Smart-managed ad-click-to-call on any campaign with both. |
| G-CT2 | **UNKNOWN (G-SYS1)** | GA4 link status not exposed in the data we pulled. Note 7 GA4 conversion actions exist (some HIDDEN), implying a link exists; verify in UI. Scored as WARNING. |
| G-CT3 | **UNKNOWN (G-SYS1)** | gtag firing requires a live site crawl. Scored WARNING. |
| G-CTV1 | **N/A** | No CTV/Video campaigns. |

### 2. Wasted Spend / Negatives (20% weight) — 33 / 100

| ID | Result | Evidence |
|---|---|---|
| G13 | **FAIL** | No change_events found in LAST_30_DAYS (empty result). No evidence of search-term review in the lookback window. |
| G14 | **FAIL** | Only one Shared Set exists (`Porsche`, type=BRANDS, **0 references**). No NEGATIVE_KEYWORDS shared lists exist. |
| G15 | **WARNING** | Negative coverage is per-campaign-only and uneven: PPC_Wallace_40Miles 93, Tesla Approved 68, JLR 68, GOOG_WAL_SRCH_TeslaApproved_2026Q2 43, ToyotaCertified 38, JLRCertified 36, LocalCollision 34, Search General 2, BMW Certified 1, Wallace Ford Brand 1. New Q2 campaigns inherit negatives but no shared list governance. |
| G16 | **FAIL** | **22.4% of search-term spend ($278.70 of $1,242.39) flows to terms with >$10 spend and 0 conversions.** 18 terms qualify. Dominated by Tesla informational/dealer/parts queries: "jaguar f pace maintenance cost" ($34), "tesla body shop near me" ($25), "tesla dealership" ($25), "tesla repair near me" ($17), "range rover dealership near me" ($17), "tesla bumper" ($15), "tesla paint repair kit" ($15), "tesla model y windshield replacement" ($14), "tesla com service" ($13), "tesla service" ($12), "tesla website" ($12), "tesla model y" ($12), "tesla model 3" ($12), "land rover johnson city tn" ($11). |
| G17 | **PASS (with caveat)** | Legacy BMM heuristic applied: 0 BROAD + MANUAL_CPC keywords found. 159 BROAD keywords all live in Smart Bidding campaigns. Two of the new Q2 campaigns (`GOOG_WAL_SRCH_JLRCertified_2026Q2` and `GOOG_WAL_SRCH_TeslaApproved_2026Q2`) use MANUAL_CPC — flag for follow-up if any BROAD keywords land there later. |
| G18 | **WARNING** | Close-variant pollution evident in Tesla campaign: "tesla body shop near me" cost $25 and 0 conv despite being a high-intent term; suggests landing-page or geo-targeting mismatch, not just close variants. Also NEAR_EXACT match accounts for 50 of 300 wasted-spend rows. |
| G19 | **PASS** | 300 search terms returned with $1,242 cost; matches expected visibility band (>60% of $1,242 of the $3,120 keyword-driven cost is the search-term visible portion = ~40% raw, but the $3,120 total includes GBP-driven Smart campaign clicks which don't appear in search_term_view). For the search-network spend specifically, visibility is reasonable. |
| G-WS1 | **PASS** | 0 keywords with >100 clicks AND 0 conversions in last 30d (most "wasted" volume is per-search-term, not per-keyword). |

### 3. Account Structure (15% weight) — 38 / 100

| ID | Result | Evidence |
|---|---|---|
| G01 | **WARNING** | Two naming conventions coexist: legacy free-form (`PPC_Wallace_40Miles`, `Tesla Approved`, `JLR Certified Collision Repairs`, `BMW Certified`, `Rivian Approved`, `Search General`) and new 2026Q2 standard (`GOOG_WAL_SRCH_<Theme>_2026Q2`). Cutover incomplete. |
| G02 | **FAIL** | Ad-group names are themed (`tesla repair shop`, `body shop`, `Land Rover Collision Repair`) but no consistent pattern; some Q2 ad groups use Title Case ("Tesla Approved Collision", "Brand Terms") while legacy use lowercase ("body shop near", "collision repair near"). |
| G03 | **PASS** | After dedup, ENABLED ad groups carry 2–8 keywords each (well within ≤10 single-theme guideline). Largest enabled ad group is "Tesla Certified Repairs" with 9 keywords, all on-theme. |
| G04 | **WARNING** | After stripping geo qualifiers, 6 distinct objectives detected (Brand, Local Collision, Tesla, JLR/LandRover, BMW, Rivian, Toyota Certified) which means 7 objectives — but several have both a legacy paused and a new Q2 ENABLED variant. Total ENABLED+PAUSED = 12 campaigns; once cutover completes and legacy is removed, count drops to 6 — acceptable. Currently fragmented during transition. |
| G05 | **FAIL** | Brand keyword coverage is anomalous: the Smart Campaign "Wallace Ford of Kingsport Brand" targets Wallace **Ford dealership** brand (different business unit), while `GOOG_WAL_SRCH_Brand_2026Q2` (intended for Wallace Collision Center brand defense) is PAUSED. Net result: **the account is not defending the Wallace Collision Center brand on search** during this lookback. |
| G06 | **FAIL** | No PMax campaigns active despite ~745 conversions/30d (well above the 30–50 conv/mo PMax threshold). |
| G07 | **N/A** | No PMax to need brand exclusions. |
| G08 | **WARNING** | Top performer by conversion volume (PPC_Wallace_40Miles, 607 conv) is PAUSED — budget allocation is decoupled from performance because the transition stalled. |
| G09 | **FAIL** | Tesla Approved: 53.6% budget-lost impression share at $30/day; JLR: 67.4% budget-lost at $30/day. Both severely budget-constrained (and now PAUSED). |
| G10 | **UNKNOWN (G-SYS1)** | Ad-schedule criteria were not visible in our `campaign_criterion` pull (no `AD_SCHEDULE` rows returned). Either none set or filtered out. Scored WARNING. |
| G11 | **FAIL** | Legacy Search General + Tesla Approved + JLR Certified + Rivian Approved use `positive_geo_target_type = PRESENCE_OR_INTEREST`. For a local collision shop this is the wrong setting and a known Quick Win. New 2026Q2 campaigns correctly use `PRESENCE` ✓. |
| G12 | **FAIL** | "Search General" (PAUSED) has `target_content_network = true` — Display on Search. Also several legacy campaigns disable `target_search_network`. New Q2 campaigns correctly only target Google Search. |

### 4. Keywords & Quality Score (15% weight) — 31 / 100

| ID | Result | Evidence |
|---|---|---|
| G20 | **FAIL** | Distribution among rated keywords (107 with QS index data): QS5=8, QS4=8, QS3=34, QS2=30, QS1=27. Impression-weighted account QS is between 2 and 3 — well below the ≥7 PASS threshold. (225 keywords have QS=0 because they're in zero-impression ad groups, mostly the new Q2 cohort.) |
| G21 | **FAIL** | Of the 107 rated keywords, 91 (85%) have QS ≤3. Threshold for FAIL is >25%. |
| G22 | **FAIL** | 93 of 107 rated keywords (87%) have `search_predicted_ctr = BELOW_AVERAGE`. |
| G23 | **WARNING** | Of 107 rated keywords: 38 ABOVE_AVERAGE, 38 AVERAGE, 31 BELOW_AVERAGE (29%). Borderline FAIL. |
| G24 | **FAIL** | 101 of 107 rated keywords (94%) have `post_click_quality_score = BELOW_AVERAGE`. Landing pages are the single largest QS drag. |
| G25 | **FAIL** | Top 20 spend keywords: QS values are 0,0,3,3,2,5,3,3,3,3,0,3,3,3,0,2,3,3,2,2 — only 1 keyword (auto body paint shop, QS=5) is ≥5; none at ≥7. |
| G-KW1 | **FAIL** | 67 of 332 unique keywords (20.2%) have 0 impressions in 30d, AND all of them are in the new Q2 cohort because those campaigns have 0 impressions overall — symptom of the stalled cutover. |
| G-KW2 | **PASS** | RSA headlines do contain primary keyword variants (sample inspection: ad groups named "tesla body shops", "Range Rover Collision Repair" etc. have headlines that mirror those themes). |

### 5. Ads & Assets (15% weight) — 56 / 100

| ID | Result | Evidence |
|---|---|---|
| G26 | **PASS** | 44 RSAs across 36 ad groups; only the 2 "Search General" dynamic ad groups and Smart-managed group lack standard RSAs (expected). |
| G27 | **PASS** | Of 44 RSAs only 2 have <8 headlines, 0 have <3. |
| G28 | **PASS** | 0 RSAs have <2 descriptions. |
| G29 | **FAIL** | **4 RSAs at POOR, 18 AVERAGE, 11 GOOD, 11 PENDING** (PENDING = Q2 cohort not yet served, will rate after first impressions). Any POOR rating = FAIL. |
| G30 | **UNKNOWN (G-SYS1)** | Headline-pin data not retrieved. Default WARNING. |
| G31 | **N/A** | No PMax. |
| G32 | **N/A** | No PMax. |
| G33 | **N/A** | No PMax. |
| G34 | **N/A** | No PMax. |
| G35 | **PASS** | Sampled RSA headlines mirror ad-group themes; ad copy is keyword-relevant. |
| G-AD1 | **PASS** | New 2026Q2 ad-group ads exist (created within the last 30 days based on the cohort name). Ad freshness present. |
| G-AD2 | **PASS** | Account CTR 6.18% beats the local-services 5.5–6.4% benchmark. (Note: heavily influenced by the Smart Brand campaign serving on highly relevant brand queries.) |
| G-PM1 → G-PM6 | **N/A** | No PMax. |
| G-AI1 | **FAIL** | AI Max for Search not evaluated. Account has >50 conv/month (744+) and meets the eligibility bar, but negative-list governance (G14 FAIL) must be fixed first. |
| G-DG1 → G-DG3 | **N/A** | No Demand Gen campaigns. |

### 6. Settings & Targeting (10% weight) — 39 / 100

| ID | Result | Evidence |
|---|---|---|
| G50 | **WARNING** | Account-level sitelinks (4) cover all campaigns by inheritance, but only "Wallace Ford of Kingsport Brand" has campaign-specific sitelinks (8). None of the 6 Wallace Collision 2026Q2 campaigns have make-specific sitelinks attached. |
| G51 | **PASS** | 15 customer-level callouts inherited by all campaigns ✓ |
| G52 | **PASS** | 3 customer-level structured snippets inherited ✓ |
| G53 | **WARNING** | Only 1 BUSINESS_LOGO image asset visible (attached to 3 paused campaigns). No standalone IMAGE extensions visible on the active campaigns. |
| G54 | **FAIL** | **Four different phone numbers** across CALL assets: (423) 652-2233, 423-454-4292, 423-397-4042, (423) 578-3600. No clear call-tracking convention; risk of attribution misalignment. The new Q2 campaigns appear to lack CALL assets entirely in our pull. |
| G55 | **FAIL** | No Lead Form extension assets detected. |
| G56 | **WARNING** | Only "Search General" (paused) has 5 USER_INTEREST audience criteria; no campaign in the Q2 cohort has audiences in Observation mode. |
| G57 | **FAIL** | No `customer.user_list` membership criteria visible at campaign or account level. |
| G58 | **FAIL** | No customer-level placement exclusions surfaced via `campaign_criterion`. Account has Display Network ON for Smart campaign and (historically) Search General. |
| G59 | **UNKNOWN (G-SYS1)** | Mobile LCP requires PageSpeed Insights run on the landing URLs. Scored WARNING. Given G24 (94% BELOW_AVERAGE landing-page experience), strong inference that mobile LP performance is a serious problem. |
| G60 | **PASS** | Final URLs are theme-matched (`/tesla-approved-body-shop-repair/`, `/bmw-certified-collision-repair-center/`, `/jaguar-land-rover-certified/`, `/toyota-certified/`, `/repair-estimate/`). UTM parameters are present and consistent. |
| G61 | **UNKNOWN (G-SYS1)** | Schema markup requires a site crawl. Scored WARNING. |
| G36 | **WARNING** | Mix: TARGET_SPEND, MAXIMIZE_CONVERSIONS, MAXIMIZE_CONVERSION_VALUE, MANUAL_CPC, TARGET_IMPRESSION_SHARE. Two enabled Q2 campaigns (JLRCertified, TeslaApproved) sit on MANUAL_CPC — appropriate while gathering conversion data, but flag for migration to Smart Bidding once each accrues 15 conv/mo. No ECPC found ✓ |
| G37 | **WARNING** | All bidding strategies show `target_cpa_micros = 0` and `target_roas = 0` — no explicit targets set, which is appropriate for Maximize Conversions but means no guardrail. |
| G38 | **UNKNOWN (G-SYS1)** | Learning-phase status not directly exposed in our pull. Default WARNING. |
| G39 | **FAIL** | Tesla Approved at 53.6% budget-lost, JLR at 67.4% budget-lost on $30/d — paused now, but the cutover replacements are at the same $30/d budget. |
| G40 | **PASS** | Manual CPC only on the two new Q2 campaigns with 0 conversions to date — appropriate. |
| G41 | **WARNING** | No portfolio bid strategies visible. Several low-volume vehicle-make campaigns running independently could benefit from a Maximize Conversions portfolio. |

---

## Wasted Spend Estimate

**Estimated monthly waste: ~$280–$350**

| Rank | Search term | Spend | Clicks | Conv | Why it's wasted |
|---|---|---|---|---|---|
| 1 | jaguar f pace maintenance cost | $34.18 | 1 | 0 | Informational/maintenance query, not collision intent |
| 2 | tesla body shop near me | $24.78 | 2 | 0 | Geo mismatch — likely served outside service area |
| 3 | tesla dealership | $24.75 | 1 | 0 | Dealer intent, not collision |
| 4 | tesla repair near me | $17.25 | 1 | 0 | Service/mechanical intent, not collision body work |
| 5 | range rover dealership near me | $17.13 | 1 | 0 | Dealer intent |
| 6 | tesla bumper | $15.34 | 1 | 0 | Parts intent, not service |
| 7 | tesla paint repair kit | $14.60 | 1 | 0 | DIY product intent |
| 8 | tesla model 3 rear window replacement cost | $14.01 | 1 | 0 | Glass replacement, not collision |
| 9 | tesla model y windshield replacement | $13.85 | 1 | 0 | Glass replacement |
| 10 | tesla com service | $12.61 | 1 | 0 | Tesla.com support intent |

Also wasted: `tesla service` $12, `tesla website` $12, `tesla model y` $12, `tesla model 3` $12, `land rover johnson city tn` $11, `cybertruck body parts` (in waste tier despite 3 conv if conv values are GBP soft conversions).

**Negative-keyword additions (Quick Win, 10 min):** `dealership`, `service`, `website`, `paint repair kit`, `windshield replacement`, `glass replacement`, `bumper` (alone), `model 3`, `model y`, `maintenance cost`, `johnson city`, `parts`, `kit`.

---

## PMax-Specific Findings

**No Performance Max campaigns active.** This is a notable gap for an account with 744+ conversions/30d (Google's recommended minimum is 30–50 conv/mo for PMax to optimize effectively). Recommend testing PMax for collision repair lead generation **only after**:
1. Conversion-action hygiene fixed (G47) so PMax doesn't over-optimize for GBP micro events.
2. At least 3 themed negative keyword lists in place (G14) for PMax campaign-level negatives.
3. Brand exclusion list ready (search themes + negative campaign-level keywords) — Wallace Collision Center brand terms must be excluded so PMax doesn't cannibalize the brand Search campaign once it goes live.

---

## AI Max / Demand Gen

| Check | Status |
|---|---|
| G-AI1 (AI Max for Search) | **FAIL** — Not evaluated despite eligibility (744 conv/mo well above 50 conv threshold). Blocker: negative-list governance (G14) must be fixed first. Action: enable AI Max on `GOOG_WAL_SRCH_LocalCollision_2026Q2` once it ramps and after negative lists are deployed. |
| G-DG1 (Demand Gen) | **N/A** — No Demand Gen campaigns. Not flagged as fail because the account is service-area-local and Demand Gen is harder to justify for a hyper-local collision shop without strong creative inventory. |
| G-DG2 (VAC migration) | **N/A** — No Video Action Campaigns ever existed. |
| G-DG3 (frequency cap loss) | **N/A** |

---

## G-SYS1 Diagnostic

Data fetches that errored or were inferred (not silently skipped):

| Source | Status | Affected checks | Mitigation |
|---|---|---|---|
| `campaign.start_date`, `campaign.end_date` | Field not recognized in API v20 | None critical; used inference from campaign-name dates | Drop fields from future pulls |
| `change_event` (LAST_30_DAYS) | First attempt error: bad fields. Retry returned empty result set. | G13 (search term audit recency) | Scored FAIL on basis of empty result — no recorded change activity in 30 days |
| `ad_group_criterion` with metrics fields | Returned "metrics incompatible with resource" error | None — switched to `keyword_view` which carries the same data | Use `keyword_view` for keyword metrics |
| `asset.image_asset.full_size.url_fingerprint` | Field not recognized | Did not affect scoring | Drop field |
| Ad-schedule `campaign_criterion` rows | No AD_SCHEDULE type returned | G10 | Scored WARNING; verify in UI |
| `search_term_view.status`, `ad_group`, `campaign` SELECT fields | SELECT-clause rejection (per gaql-notes.md known incompatibility) | G16, G19 | Refetched with `segments.search_term_match_type` only; status filter applied in app layer (none filtered) |
| GA4 link status | Not exposed in pulled resources | G-CT2 | Scored WARNING; verify in UI |
| Consent Mode v2 mode (Basic vs Advanced) | Not exposed in API | G45 | Scored WARNING |
| Server-side tracking presence | Not derivable from API | G44 | Scored WARNING |
| Headline pin map | Not pulled (large data) | G30 | Default WARNING |
| Learning-phase per campaign | Not directly exposed | G38 | Default WARNING |
| Mobile LCP / schema markup | Requires site crawl | G59, G61 | Default WARNING; G24 evidence implies G59 is likely a FAIL |

Total inferred / warning-defaulted checks: 10 of 80. None silently skipped.

---

## Action Plan (next 30 days)

### Week 1 — Stop the bleed and finish the cutover
1. **(2 hours) Decide on cutover direction.** Either (a) re-enable the legacy PPC_Wallace_40Miles + Tesla Approved + JLR campaigns to restore impression volume while the Q2 stack matures, or (b) push the Q2 stack live by adding ad copy, attaching extensions, and enabling the Brand 2026Q2 campaign. Current half-launched state is leaking the brand defense and conversion volume.
2. **(5 min) Demote micro conversions.** Set `Local actions - Directions/Website visits/Other engagements/Menu views` to `primary_for_goal = false` AND `include_in_conversions_metric = false`. Keep Form, Calls from ads, qualify_lead, Calls from Smart Campaign Ads as Primary. This will drop the bogus 39.77% CVR to a realistic 8–12% and let Smart Bidding optimize cleanly. (`googleads_psg.mutations.conversion_actions.apply_changes` — see `ops/wallace/fix_qualify_lead_category.py` for pattern.)
3. **(10 min) Fix geo targeting on legacy campaigns.** Switch `positive_geo_target_type` from `PRESENCE_OR_INTEREST` to `PRESENCE` on Search General, Tesla Approved, JLR Certified, Rivian Approved.
4. **(10 min) Disable Display Network on Search General** before it ever reactivates.
5. **(15 min) Build 3 shared negative lists**: `WAL_Negatives_Competitor`, `WAL_Negatives_Jobs+Free+Info`, `WAL_Negatives_Tesla_Parts+Service`. Attach to all ENABLED Search campaigns.

### Week 2 — Negatives + assets
6. **(15 min) Add the 13 negative keywords** identified in the wasted-spend table to the Tesla & JLR campaigns directly. Will recover ~$280/mo.
7. **(30 min) Repair the 4 POOR RSAs.** Add 4–5 keyword-rich headlines per RSA targeting "auto body repair", "collision repair near me", "free estimate", "insurance approved", "Wallace Collision Center".
8. **(15 min) Add 4 sitelinks per Q2 campaign** (Get Free Estimate, Tesla Approved, BMW Certified, Insurance Direct Repair / equivalents per theme).
9. **(15 min) Consolidate call assets** on a single tracked number; verify "Calls from ads" continues to attribute.

### Week 3 — Bidding + landing pages
10. **(60 min) Brief site team on mobile LCP** for `/tesla-approved-body-shop-repair/`, `/bmw-certified-collision-repair-center/`, `/jaguar-land-rover-certified/`, `/toyota-certified/`, `/repair-estimate/`. The 94% BELOW_AVERAGE landing-page experience signal is the single biggest QS lever.
11. **(30 min) Add schema markup** (LocalBusiness, AutoRepair, Service) to the same landing pages.
12. **(30 min) Plan Customer Match upload** of past-customer email list for remarketing/exclusion.

### Week 4 — Growth levers
13. **(60 min build) Launch PMax pilot** with brand exclusions + the new negative lists, using `Local Services + Tesla + JLR` images, native logos, and a square video. Target $40–60/d.
14. **(30 min) Evaluate AI Max for Search** on `GOOG_WAL_SRCH_LocalCollision_2026Q2` once the Q2 stack accrues 50+ conversions and negative lists are confirmed.
15. **(15 min) Move two MANUAL_CPC Q2 campaigns** (JLRCertified, TeslaApproved) to Maximize Conversions once each accrues ≥15 conv/mo.

---

*Audit produced via claude-ads/ads-google v1.5 rubric. Source data: `mcp__google-ads-mcp__search` against Google Ads API v20 on 2026-05-18.*
