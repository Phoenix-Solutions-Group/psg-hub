# Wallace Collision Center — Google Ads Audit
**Date:** 2026-05-27 | **Window:** LAST_30_DAYS (2026-04-27 → 2026-05-27) | **Customer ID:** 6048611995 | **MCC:** 6935795509 (Phoenix Solutions Group)
**Prior audit:** 2026-05-18 (38/100, Grade F) | **Delta:** +13 points

---

## Health Score

**Google Ads Health Score: 51 / 100 — Grade D (Significant Problems)**

| Category | Score | Bar | Weight | Δ vs 5/18 |
|---|---|---|---|---|
| Conversion Tracking | 55 / 100 | ██████░░░░ | 25% | +16 |
| Wasted Spend / Negatives | 50 / 100 | █████░░░░░ | 20% | +17 |
| Account Structure | 55 / 100 | ██████░░░░ | 15% | +17 |
| Keywords & Quality Score | 35 / 100 | ████░░░░░░ | 15% | +4 |
| Ads & Assets | 60 / 100 | ██████░░░░ | 15% | +4 |
| Settings & Targeting | 45 / 100 | █████░░░░░ | 10% | +6 |

**Weighted: (55×.25) + (50×.20) + (55×.15) + (35×.15) + (60×.15) + (45×.10) = 51**

*Note: Score is a category-level estimate. Prior audit (5/18) used rigorous per-check rubric scoring (38.6). This 51 is directional, not directly comparable at decimal precision. The improvement trajectory (F to D) is real based on verified fixes.*

---

## Account Snapshot

| Metric | Value (LAST_30_DAYS) | Δ vs 5/18 |
|---|---|---|
| Total spend | **$2,897.72** | -$487 (30d window shift) |
| Impressions | 24,422 | -5,887 |
| Clicks | 1,445 | -427 |
| Conversions (in-metric) | 525.98 | -218 (signal cleanup reduced count) |
| All conversions | 811.65 | — |
| Account CTR | 5.92% | -0.26pp |
| Account CPC | $2.01 | +$0.20 |
| Auto-tagging | ON ✓ | — |
| Optimization score | 60.1% | -2.6pp |

**Active campaign breakdown (ENABLED only):**

| Campaign | Type | Bidding | Daily Budget | 30d Spend | Impr | Clicks | Conv | SIS | Budget Lost | Rank Lost |
|---|---|---|---|---|---|---|---|---|---|---|
| GOOG_WAL_SRCH_LocalCollision_2026Q2 | SEARCH | MAX_CONV | $43 | $307.20 | 737 | 52 | 5.0 | 53.3% | 3.7% | 43.0% |
| Wallace Ford of Kingsport Brand | SMART | TARGET_SPEND | $9 | $271.16 | 10,160 | 769 | 85.0 | — | — | — |
| GOOG_WAL_SRCH_TeslaApproved_2026Q2 | SEARCH | MANUAL_CPC | $30 | $156.10 | 55 | 9 | 0 | 87.5% | 2.5% | 10.0% |
| GOOG_WAL_SRCH_ToyotaCertified_2026Q2 | SEARCH | TARGET_SPEND | $13 | $51.94 | 48 | 8 | 1.0 | 37.8% | 23.2% | 39.0% |
| GOOG_WAL_SRCH_Brand_2026Q2 | SEARCH | TARGET_SPEND | $15 | $18.83 | 65 | 14 | 6.0 | 74.1% | 1.7% | 24.1% |
| GOOG_WAL_SRCH_JLRCertified_2026Q2 | SEARCH | MANUAL_CPC | $30 | $0 | 7 | 0 | 0 | 80.0% | 0% | 20.0% |

**Paused legacy (still showing 30d metrics from pre-pause period):**

| Campaign | 30d Spend | Impr | Clicks | Conv |
|---|---|---|---|---|
| Tesla Approved | $840.57 | 3,039 | 119 | 24 |
| PPC_Wallace_40Miles | $701.38 | 8,655 | 413 | 394 |
| JLR Certified Collision Repairs | $550.54 | 1,656 | 61 | 11 |

---

## What Changed Since May 18 Audit

| Fix | Status | Check(s) Affected |
|---|---|---|
| Q2 RSAs unpaused — 11 ads now serving | ✅ Done 5/20 | G-AD1, A1 |
| Brand_2026Q2 campaign enabled, budget $7→$15/d, TARGET_SPEND | ✅ Done 5/20 | G05 |
| OEM negatives deployed (315 per-campaign negatives across 7 OEM campaigns) | ✅ Done 5/20 | G15, G16 |
| GBP micro conversions removed from conv metric (Directions, Website visits, Other engagements, Menu views) | ✅ Done 5/20 | G47 |
| Landing Page action demoted (include=false, primary=false) | ✅ Done 5/20 | G47 |
| Smart campaign map directions removed from conv metric | ✅ Done 5/20 | G47 |
| Final URLs remapped to correct landing pages | ✅ Done 5/20 | G60 |
| Tesla/JLR Q2 keywords expanded | ✅ Done 5/21 | G-KW1 |
| Toyota disapproval appeals submitted | ✅ Done 5/20 | G-AD policy |
| qualify_lead counting_type → ONE_PER_CLICK | ❌ Still MANY_PER_CLICK | G-CT1 |
| Smart campaign ad clicks to call → exclude from conv metric | ❌ Still include=true (0 vol) | G-CT1 |
| Shared negative keyword lists | ❌ Not built | G14 |
| Legacy geo targeting fix (PRESENCE_OR_INTEREST) | ❌ Not done (paused, low urgency) | G11 |
| LocalCollision Q2 negatives | ❌ 0 negatives deployed | G15 |

---

## Quick Wins (sorted by severity × impact)

| # | Check | Issue | Fix | Time | Impact |
|---|---|---|---|---|---|
| 1 | G-CT1 | `qualify_lead` (7194760257) still `MANY_PER_CLICK` — 176 all_conv in 30d, inflating Smart Bidding signal. **GA4-imported action: counting_type is immutable via Google Ads API.** | Fix in GA4 admin: set qualify_lead event counting to "Once per session" (or audit upstream GTM firing to prevent duplicate events). Cannot be changed via API. | 15 min (GA4 admin) | **Critical** — single biggest remaining signal-quality blocker |
| 2 | G15 | `GOOG_WAL_SRCH_LocalCollision_2026Q2` has **0 negatives** — highest-spend Q2 campaign ($307/30d) is wide open | Deploy negatives from PPC_Wallace_40Miles (93 terms) or build shared list | 15 min | **Critical** — currently bleeding to windshield, glass, competitor, paint-cost queries |
| 3 | G14 | Still no shared negative keyword lists. 500 negatives exist but all per-campaign, uncoordinated | Create 3 shared lists + attach to all ENABLED Search campaigns | 20 min | **High** — governance gap, prevents drift |
| 4 | G15 | `GOOG_WAL_SRCH_JLRCertified_2026Q2` has only 5 negatives (vs. legacy JLR's 113) | Copy negatives from legacy JLR or shared list | 10 min | **High** — will bleed when volume grows |
| 5 | G20 | Impression-weighted QS 3.16, LP experience 86.4% BELOW_AVERAGE — LP quality is dominant QS drag | Brief site team on mobile LCP + page-structure improvements for `/collision-repair/`, `/tesla-approved/`, `/certifications/` | 60 min brief | **High** — affects all campaigns systemically |
| 6 | G39 | ToyotaCertified Q2 losing 23.2% budget + 39% rank at only $13/d budget — underspending while losing auctions | Raise Toyota budget to $20-25/d once `/certifications/toyota/` page ships | 2 min | **Medium** — blocked by landing page |
| 7 | G09 | LocalCollision Q2 losing 43% rank at $43/d — rank-lost IS dominates budget-lost | Improve QS (LP quality is root cause) or test tCPA to control bids | ongoing | **High** — $43/d budget is adequate but bids lose |
| 8 | G-CT1 | `Smart campaign ad clicks to call` (7258748379) still `include_in_conversions_metric=true` — 0 volume but misconfigured. **Smart-campaign-managed action: immutable via API.** | Cannot change via API. Options: (a) accept (0 vol, no real impact), or (b) archive/pause Wallace Ford Smart campaign to remove the action entirely | N/A | **Low** — 0 volume, immutable |
| 9 | G06 | No PMax campaigns. Account eligible (525+ conv/30d) | Launch PMax pilot with brand exclusions after shared negatives deployed | 60 min build | **High** over 30d |
| 10 | G55 | No lead form extensions on any campaign | Add lead form to LocalCollision and OEM Q2 campaigns | 20 min | **Medium** |

---

## Findings by Category

### 1. Conversion Tracking (25% weight) — 55 / 100 (+16)

| ID | Result | Evidence |
|---|---|---|
| G42 | **WARNING** | 5 actions in conversions metric (was 8). Calls from ads, qualify_lead, Calls from Smart Campaign Ads, Smart ad clicks to call, Form. qualify_lead at 176 all_conv dominates; MANY_PER_CLICK inflates count. |
| G43 | **PASS** | `enhanced_conversions_for_leads_enabled = true` ✓ |
| G44 | **UNKNOWN** | Server-side tracking presence requires site audit. Scored WARNING. |
| G45 | **UNKNOWN** | Consent Mode v2 mode not surfaced in API. US-only account, lower EEA exposure. Scored WARNING. |
| G47 | **PASS** | GBP micro conversions (Directions, Website visits, Other engagements, Menu views) all set to `include_in_conversions_metric = false`. **Fixed since 5/18.** |
| G48 | **PASS** | Primary actions now on DDA where eligible. Calls from ads: DDA ✓. qualify_lead: DDA ✓. Form: DDA ✓. |
| G-CT1 | **FAIL** | `qualify_lead` still `MANY_PER_CLICK` (176 all_conv/30d). `Smart campaign ad clicks to call` still in conv metric (0 vol). `clean_smart_bidding_signal.py` executed 5/20 but correctly identified both as **immutable via Google Ads API** — GA4-imported and Smart-campaign-managed actions cannot be mutated at the ConversionAction level. The script's goal-level demotions (CustomerConversionGoal biddable=False) were already applied. Fix qualify_lead counting in **GA4 admin** (not Google Ads API). |
| G-CT2 | **UNKNOWN** | GA4 link status not exposed. 7 GA4 conversion actions exist (some HIDDEN). Scored WARNING. |

### 2. Wasted Spend / Negatives (20% weight) — 50 / 100 (+17)

| ID | Result | Evidence |
|---|---|---|
| G14 | **FAIL** | Only 1 shared set (`Porsche`, BRANDS type, 6 members). **No NEGATIVE_KEYWORDS shared lists.** 500 negatives exist per-campaign but ungoverned. |
| G15 | **FAIL** | Uneven coverage: Tesla Approved 113, JLR 113, PPC_Wallace 93, ToyotaCertified Q2 83, BMW 46, Rivian 45, **JLRCertified Q2: 5**, **TeslaApproved Q2: limit hit (likely covered)**, **LocalCollision Q2: 0**, Brand Q2: 0, Search General: 2. LocalCollision Q2 is highest-spend Q2 campaign with zero negatives. |
| G16 | **WARNING** | Legacy waste still visible in 30d window (jaguar f pace $34, tesla dealership $25, etc.) but those campaigns now PAUSED. Q2 waste lower: "services offered by johnson city toyota" $7.96, competitor queries ($8.57 Gerber, $4.33 Stateline), paint-cost queries. Improved but not clean. |
| G17 | **PASS** | No BROAD + MANUAL_CPC combinations. BROAD keywords in Smart Bidding campaigns only ✓ |
| G18 | **WARNING** | Close-variant matches still generating some non-collision traffic. "tesla body repair near me" $22.55 (NEAR_EXACT, relevant but 0 conv). "body shops that do rust repair near me" $10.43 (PHRASE, 0 conv). |

**Estimated monthly waste (Q2 campaigns only, excluding legacy):**
- Q2 Tesla: ~$42 on non-collision repair terms ($10.31 repair shop, $9.72 repair near me broad)
- Q2 Toyota: ~$16 on dealer intent ($7.96 johnson city toyota services, $7.94 toyota collision center kingsport)
- Q2 Local: ~$45 on competitor + paint-cost + irrelevant ($15.28 best body shop 0 conv, $8.57 gerber, $7.22 maaco, $4.33 stateline, $3.29 PDR)
- **Q2 waste estimate: ~$103/mo** (down from ~$280 estimated May 18 across full account)

### 3. Account Structure (15% weight) — 55 / 100 (+17)

| ID | Result | Evidence |
|---|---|---|
| G01 | **WARNING** | Two naming conventions still coexist. Legacy paused but not removed. |
| G05 | **PASS** | Brand_2026Q2 ENABLED, serving, SIS 74.1%, 14 clicks, 6 conv. **Fixed since 5/18.** |
| G06 | **FAIL** | No PMax campaigns despite 525+ conv/30d (eligible). |
| G08 | **WARNING** | Legacy PPC_Wallace_40Miles (394 conv) PAUSED. Q2 LocalCollision replacement at 5 conv — data gap during transition, expected. |
| G09 | **WARNING** | LocalCollision Q2: 43% rank-lost at $43/d budget — rank-loss-dominant, not budget-loss. Root cause is QS not budget. |
| G11 | **FAIL** | Tesla Approved, JLR Certified, Rivian Approved, Search General still `PRESENCE_OR_INTEREST`. All PAUSED — no active bleed but bug persists for reactivation. |
| G12 | **FAIL** | Search General still `target_content_network = true`. PAUSED. |

### 4. Keywords & Quality Score (15% weight) — 35 / 100 (+4)

| ID | Result | Evidence |
|---|---|---|
| G20 | **FAIL** | 370 total keywords, 118 rated. QS distribution: QS1=28, QS2=29, QS3=36, QS4=10, QS5=9, QS6=2, QS7=4. Impression-weighted QS: **3.16** (below ≥7 PASS). |
| G21 | **FAIL** | 103 of 118 rated keywords (87%) have QS ≤3. Threshold for FAIL is >25%. |
| G22 | **FAIL** | 103 of 118 rated keywords (87%) have `search_predicted_ctr = BELOW_AVERAGE`. |
| G23 | **WARNING** | Creative quality mixed: 44 ABOVE_AVERAGE, 41 AVERAGE, 33 BELOW_AVERAGE. Better than CTR/LP but still 28% below. |
| G24 | **FAIL** | **102 of 118 rated keywords (86.4%) have `post_click_quality_score = BELOW_AVERAGE`.** Only 5 ABOVE_AVERAGE. Landing page quality remains the single biggest QS drag. Down from 94% on 5/18 — slight improvement but still critical. |
| G25 | **FAIL** | Best QS keywords: Brand terms (QS 7), PDR near me (QS 7), Tesla collision repair (QS 6). Everything else ≤5. |
| G-KW1 | **WARNING** | 252 of 370 keywords (68%) have QS=0 (unrated). 88 Q2 keywords, only 18 rated — expected, Q2 just started serving 5/20. |

**Q2 keyword ratings (promising):**
| Keyword | Campaign | QS | Note |
|---|---|---|---|
| wallace collision center | Brand Q2 | 7 | ✓ |
| wallace collision | Brand Q2 | 7 | ✓ |
| wallace body shop | Brand Q2 | 7 | ✓ |
| paintless dent repair near me | LocalCollision Q2 | 7 | ✓ |
| tesla collision repair | TeslaApproved Q2 | 6 | Good |
| wallace collision bristol tn | Brand Q2 | 6 | Good |
| collision repair kingsport | LocalCollision Q2 | 5 | Acceptable |
| body shop near me | LocalCollision Q2 | 4 | LP drag |
| collision repair near me | LocalCollision Q2 | 4 | LP drag |
| auto body shop near me | LocalCollision Q2 | 3 | LP drag |
| toyota body shop near me | ToyotaCertified Q2 | 1 | LP + relevance |
| tesla body repair | TeslaApproved Q2 | 1 | LP drag |

### 5. Ads & Assets (15% weight) — 60 / 100 (+4)

| ID | Result | Evidence |
|---|---|---|
| G26 | **PASS** | All Q2 campaigns have RSAs. 11 Q2 RSAs ENABLED and serving. |
| G29 | **UNKNOWN** | `ad_group_ad.ad.strength` not available in API v20. Cannot rescore. |
| G-AD1 | **PASS** | Q2 ads are fresh (created 5/13, unpaused 5/20). All APPROVED. |
| G-AD-POLICY | **PASS** | All 11 Q2 RSAs show `approval_status = APPROVED`. Toyota ads pointing to `/certifications/` now APPROVED (was DISAPPROVED on 5/20 — appeal worked or generic page accepted). |
| G-AI1 | **FAIL** | AI Max for Search not enabled. Account has 525+ conv/mo. Blocked by: (1) shared negative list governance (G14), (2) qualify_lead MANY_PER_CLICK. |

**Toyota landing page note:** Toyota ads now point to `/certifications/` and are APPROVED. However, per 5/20 Landing Page Report, this page scores 38/F for message match — H1 says "Certifications" (generic), zero Toyota-specific copy. Google accepted it for now, but QS will be low and policy reversal risk exists. Building `/certifications/toyota/` remains high priority.

### 6. Settings & Targeting (10% weight) — 45 / 100 (+6)

| ID | Result | Evidence |
|---|---|---|
| G50 | **WARNING** | Account-level sitelinks inherited. No campaign-specific sitelinks on Q2 campaigns. |
| G54 | **FAIL** | 4 phone numbers across CALL assets. No call-tracking consolidation. |
| G55 | **FAIL** | No lead form extensions. |
| G56 | **WARNING** | No audiences in observation mode on Q2 campaigns. |
| G57 | **FAIL** | No customer match lists. |
| G60 | **PASS** | Final URLs correctly mapped: LocalCollision → `/collision-repair/`, Tesla → `/tesla-approved/`, JLR → `/jlr-certified-repair-center/`, Toyota → `/certifications/`, Brand → `/`. **Fixed since 5/18.** |

---

## Conversion Action Summary (current state)

| Action | ID | In Conv Metric | Primary | Counting | 30d All Conv | Status |
|---|---|---|---|---|---|---|
| qualify_lead (GA4) | 7194760257 | **YES** | YES | **MANY** ⚠️ | 176 | Fix to ONE_PER_CLICK |
| Calls from Smart Campaign Ads | 7258584434 | YES | YES | ONE | 75 | OK |
| Calls from ads | 565570527 | YES | YES | MANY | 41 | OK (ad call type) |
| Form (GA4) | 7258748556 | YES | YES | ONE | 2 | OK |
| Smart campaign ad clicks to call | 7258748379 | **YES** ⚠️ | YES | MANY | 0 | Set to exclude |
| Landing Page | 519845175 | no | no | MANY | 378 | ✅ Demoted |
| Local actions - Other engagements | 564345007 | no | yes | MANY | 62 | ✅ Demoted |
| Local actions - Directions | 563131646 | no | yes | MANY | 31 | ✅ Demoted |
| Clicks to call (GBP) | 563132063 | no | yes | MANY | 25 | ✅ Demoted |
| Local actions - Website visits | 564340687 | no | yes | MANY | 16 | ✅ Demoted |
| Store visits | 7231016375 | no | yes | MANY | 5.7 | Google-managed |

---

## Wasted Spend Detail (Q2 campaigns, top offenders)

| Search Term | Campaign | Spend | Clicks | Conv | Issue |
|---|---|---|---|---|---|
| tesla certified body shop near me | TeslaApproved Q2 | $22.63 | 1 | 0 | Relevant query, 0 conv — LP or geo issue |
| tesla body repair near me | TeslaApproved Q2 | $22.55 | 1 | 0 | Relevant, high CPC. Monitor. |
| best body shop near me | LocalCollision Q2 | $15.28 | 4 | 0 | Generic. 0 negatives on LocalCollision. |
| wallace collision center bluff city | LocalCollision Q2 | $15.27 | 1 | 1 | Brand query hitting LocalCollision — should be caught by Brand Q2 |
| tri cities collision johnson city tn | LocalCollision Q2 | $14.33 | 1 | 0 | Competitor name (Tri-Cities Collision) |
| caliber collision johnson city | LocalCollision Q2 | $13.66 | 1 | 0 | Competitor conquest — deliberate? |
| body shops that do rust repair near me | LocalCollision Q2 | $10.43 | 1 | 0 | Rust repair ≠ collision. Negative candidate. |
| tesla repair shop near me | TeslaApproved Q2 | $10.31 | 1 | 0 | Mechanic intent, not collision |
| tesla repair near me | TeslaApproved Q2 | $9.72 | 2 | 0 | Mechanic/service intent |
| services offered by johnson city toyota | ToyotaCertified Q2 | $7.96 | 1 | 0 | Dealer intent |
| gerber collision bristol tn | LocalCollision Q2 | $8.57 | 1 | 0 | Competitor |
| maaco $300 paint job near me | LocalCollision Q2 | $7.22 | 1 | 0 | Price shopper |

**Legacy waste (from pre-pause period, will wash out of 30d window by ~6/1):**
Still showing: jaguar f pace maintenance $34, tesla dealership $25, tesla body shop near me $25, tesla repair near me $17, range rover dealership $17. All from PAUSED campaigns — will zero out in next audit.

---

## Budget Analysis

| Campaign | Daily Budget | 30d Spend | Budget Util | Budget Lost IS | Rank Lost IS | Verdict |
|---|---|---|---|---|---|---|
| LocalCollision Q2 | $43 | $307 (≈$10/d avg) | 24% | 3.7% | **43.0%** | Budget adequate. QS is bottleneck. |
| TeslaApproved Q2 | $30 | $156 (≈$5/d avg) | 17% | 2.5% | 10.0% | MANUAL_CPC limiting volume. Low impressions (55). |
| ToyotaCertified Q2 | $13 | $52 (≈$1.7/d avg) | 13% | **23.2%** | **39.0%** | Underspending AND losing both budget + rank. |
| Brand Q2 | $15 | $19 (≈$0.6/d avg) | 4% | 1.7% | 24.1% | Brand terms cheap. Budget surplus OK. |
| JLRCertified Q2 | $30 | $0 | 0% | 0% | 20.0% | MANUAL_CPC at too-low bids? 7 impr, 0 clicks. |
| Wallace Ford Smart | $9 | $271 (≈$9/d avg) | 100% | — | — | Smart campaign maxing budget. Cross-biz. |

**Total ENABLED daily budget: $140/d ($4,200/mo)**
**Actual ENABLED 30d spend: $805 ($26.8/d avg)**
**Budget utilization: 19%** — account is severely underdelivering relative to allocated budget.

Root causes:
1. MANUAL_CPC on Tesla Q2 and JLR Q2 — bids too low for competitive market
2. QS-driven rank loss on LocalCollision Q2 (43% rank lost)
3. Toyota limited by small budget + poor QS (LP is `/certifications/` generic)
4. Q2 campaigns only live since 5/20 (7 days) — algorithms still learning

---

## Action Plan (next 30 days)

### Week 1 — Critical fixes (estimated: 2 hours)

1. **(15 min) Fix qualify_lead counting in GA4 admin.** Go to GA4 property > Admin > Events > qualify_lead > set counting method to "Once per session." The Google Ads API cannot mutate this field (GA4-imported action, `counting_type` is immutable). Alternatively, audit the GTM tag firing the event and add a "fire once per pageview" trigger. Verify change propagated to Google Ads after 24h.

2. **(N/A) Smart campaign ad clicks to call.** Immutable (Smart-campaign-managed). 0 volume currently. Accept or archive Wallace Ford Smart campaign to eliminate. Low priority.

3. **(15 min) Deploy negatives to LocalCollision Q2.** This is the highest-spend Q2 campaign with zero negatives. At minimum, copy these from PPC_Wallace_40Miles (93 terms) or build targeted list:
   - Competitor: `gerber`, `caliber`, `maaco`, `stateline`, `tri-cities collision`, `em collision`
   - Non-collision: `windshield`, `glass`, `rust repair`, `paint job cost`, `dent removal`, `PDR`
   - Intent: `how much`, `cost to`, `DIY`, `kit`, `for sale`

4. **(20 min) Build 3 shared negative keyword lists** and attach to all ENABLED Search campaigns:
   - `WAL_Neg_Competitors`: gerber, caliber, maaco, stateline, service king, carstar
   - `WAL_Neg_NonCollision`: windshield, glass, rust, paint job cost, dent removal, PDR, towing, mechanic, oil change, alignment
   - `WAL_Neg_IntentFilter`: DIY, kit, for sale, how to, youtube, review, salary, jobs, hiring, career

5. **(5 min) Copy negatives from legacy JLR (113 terms) to JLRCertified Q2** (currently has 5).

### Week 2 — Volume and quality (estimated: 3 hours)

6. **(30 min) Address JLR Q2 and Tesla Q2 bid strategy.** Both on MANUAL_CPC with near-zero spend. Either:
   - Raise manual bids to $8-12 range for competitive Tesla/JLR collision terms
   - Switch to Maximize Conversions (risky with low conversion volume)
   - Recommended: raise bids first, accumulate 15+ conv, then switch bidding

7. **(15 min) Raise Toyota Q2 budget to $20-25/d** once `/certifications/toyota/` page ships. Currently losing 23.2% to budget + 39% to rank at $13/d.

8. **(60 min) Brief site team on landing page quality.** 86.4% of rated keywords have BELOW_AVERAGE post-click quality. Key pages needing work:
   - `/collision-repair/` — add above-fold form, optimize LCP
   - `/tesla-approved/` — same
   - `/certifications/` — ship `/certifications/toyota/` per 5/20 brief
   - All pages: WebP hero images, schema markup, review stars

9. **(15 min) Add campaign-specific sitelinks to Q2 campaigns.** Make-specific for OEM campaigns, service-specific for LocalCollision.

### Week 3 — Growth levers (estimated: 2 hours)

10. **(60 min) Launch PMax pilot** with brand exclusions + shared negative lists. Target $40/d. Requires: G14 fixed (shared lists), G-CT1 fixed (qualify_lead counting), 2 weeks of Q2 conversion data.

11. **(15 min) Add lead form extensions** to LocalCollision and ToyotaCertified Q2.

12. **(30 min) Plan Customer Match upload** for remarketing/exclusion.

### Week 4 — Monitoring and optimization

13. Review Q2 search term reports weekly. The 30d window currently includes legacy campaign waste that will wash out by 6/1.
14. Monitor qualify_lead counting fix persistence.
15. Evaluate AI Max for Search eligibility (needs: shared negatives, clean conv signal, 50+ conv/mo on target campaign).

---

## Score Trajectory

| Date | Score | Grade | Key Changes |
|---|---|---|---|
| 2026-05-18 | 38 | F | Baseline audit. Account dark, signal corrupted. |
| 2026-05-27 | 51 | D | Q2 live, brand defended, GBP micro-conv demoted, OEM negatives deployed. |
| Target 6/15 | 65-70 | C/B | qualify_lead fix, shared negatives, LP improvements, bid strategy fixes. |
| Target 7/15 | 75-80 | B | PMax pilot, LP overhaul, AI Max evaluation, customer match. |

---

*Audit produced via claude-ads/ads-google rubric. Source data: `mcp__google-ads-mcp__search` against Google Ads API on 2026-05-27.*
