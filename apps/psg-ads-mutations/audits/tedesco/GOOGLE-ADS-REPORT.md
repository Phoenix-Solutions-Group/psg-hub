# Tedesco Auto Body — Google Ads Audit
**Date:** 2026-05-18 | **Window:** LAST_30_DAYS (Apr 18 – May 18, 2026) | **Customer ID:** 7763526490 | **MCC:** 6935795509 (PSG)

## Health Score

**Google Ads Health Score: 60/100 (Grade C — Needs Improvement)**

```
Conversion Tracking: 73/100  ████████░░  (25%)
Wasted Spend:        61/100  ██████░░░░  (20%)
Account Structure:   63/100  ██████░░░░  (15%)
Keywords & QS:       48/100  █████░░░░░  (15%)
Ads & Assets:        46/100  █████░░░░░  (15%)
Settings:            47/100  █████░░░░░  (10%)
```

**Math (weighted, severity-multiplied):**
Σ(C_pass × W_sev × W_cat) = 17.375
Σ(C_total × W_sev × W_cat) = 28.975
17.375 / 28.975 × 100 = **60.0**

Per-category:
- CT: 6.375 / 8.750 = 72.9
- WS: 3.700 / 6.100 = 60.7
- AS: 2.513 / 3.975 = 63.2
- KW: 1.650 / 3.450 = 47.8
- AD: 1.462 / 3.150 = 46.4
- ST: 1.675 / 3.550 = 47.2

---

## Account Snapshot

- **Currency / TZ:** USD / America/Chicago
- **Google account-level optimization score:** 60.7%
- **Auto-tagging:** ON
- **Enhanced Conversions for Leads:** ON
- **Customer data terms:** Accepted

**30-day performance (ENABLED campaigns only):**

| Campaign | Channel | Bid Strategy | Spend | Clicks | Impr | CTR | Conv | CPA |
|---|---|---|---|---|---|---|---|---|
| Auto Body and Collision Repair Tesla Rivian | SMART | TARGET_SPEND | $657.67 | 2,171 | 66,538 | 3.26% | 45.00 | $14.62 |
| Insurance-Focused Family Commuter | SEARCH | MAX_CONV | $605.78 | 583 | 13,844 | 4.21% | 4.50 | $134.62 |
| Quality-Driven Luxury Owner | SEARCH | MAX_CONV | $594.22 | 622 | 15,375 | 4.05% | 4.50 | $132.05 |
| Budget-Conscious Urban Driver | SEARCH | MAX_CONV | $603.23 | 608 | 22,154 | 2.74% | 10.50 | $57.45 |
| EV Owners | SEARCH | MAX_CONV | $588.11 | 591 | 17,934 | 3.30% | 6.00 | $98.02 |
| **TOTAL** | | | **$3,049.02** | **4,575** | **135,845** | **3.37%** | **70.50** | **$43.25** |

7 Search campaigns and 2 PMax campaigns are PAUSED. The four persona-based Search campaigns (launched recently) and the legacy Smart Campaign are the only active spend.

**Counts (active):**
- Enabled campaigns: 5 (4 Search + 1 Smart)
- Enabled ad groups: 23 of 73
- Enabled keywords: 97 (all BROAD match), 30 of 97 received impressions; 67 zero-impression
- Enabled RSAs: 66 + 4 SMART_CAMPAIGN_AD (auto)
- Conversion actions (advertiser-controlled, ENABLED): 2 ("Start Estimate Request" BOOK_APPOINTMENT, "Contact Us" CONTACT/GA4)
- Conversion actions (system, Smart Campaign): 4 (excluded from DDA/duplicate checks per audit rules)

---

## Quick Wins

| Check | Issue | Fix | Time | Est. Impact |
|---|---|---|---|---|
| G11 | All 4 persona campaigns use **PRESENCE_OR_INTEREST** geo targeting | Switch positive_geo_target_type to PRESENCE for local body shop | 2 min | Cut out-of-market clicks; ~5–15% spend recapture |
| G14/G15 | Zero shared negative keyword lists in use across the account | Create themed lists (Jobs/Careers, DIY/How-to, Cheap-junk, Insurance-info, Competitors), apply to all Search | 15 min | Reduce irrelevant clicks across all campaigns at once |
| G50 | The 4 ENABLED persona Search campaigns have **no campaign-attached sitelinks** (only legacy paused sitelinks + account-level) | Attach 4+ sitelinks per persona campaign | 10 min | +10–20% CTR typical |
| G27 | Every RSA has only **5 headlines** (recommended ≥8, ideal 12–15) | Add 5+ headline variants per RSA | 15 min/group | Move ad strength off POOR; +10–25% CTR |
| G29 | **56 of 66 RSAs are POOR**, 10 AVERAGE, 0 Good/Excellent | Rebuild with more headlines/descriptions, fewer pins, keyword variants | <1 hr | Improve QS, eligibility |
| G56/G57 | No audience signals or Customer Match list applied | Add in-market "Auto body repair," remarketing, and CM list in Observation | 10 min | Free intelligence on who's converting |
| G6 | All PMax campaigns are PAUSED | Re-enable or retire; Local PMax is well-suited to body shops | 5 min | New conversion volume |
| G-AI1 | AI Max for Search not evaluated | Test on one persona campaign after negatives strengthened | 15 min | Avg 14% conv lift per Google |

---

## Findings by Category

### Conversion Tracking (25% weight) — 73/100

| ID | Check | Result | Evidence |
|---|---|---|---|
| G42 | Primary conversion actions defined | PASS | 2 advertiser-controlled ENABLED primaries: "Start Estimate Request" (BOOK_APPOINTMENT, DDA, value $1,620) and "Contact Us" (CONTACT, GA4_CUSTOM, DDA) |
| G43 | Enhanced conversions for leads | PASS | `enhanced_conversions_for_leads_enabled = true` at customer level |
| G44 | Server-side tracking | WARNING | No evidence in API of server-side GTM / conversion-import; primary actions all WEBSITE origin |
| G45 | Consent Mode v2 | FAIL | No evidence of Consent Mode v2 implementation. US-only audience but recommended for full signal recovery |
| G46 | Conversion window appropriate | PASS | Primary "Start Estimate Request" uses 30-day window (appropriate for lead-gen sales cycle) |
| G47 | Macro vs micro separation | WARNING | "Contact Us" (CONTACT category) is marked primary; arguably a soft conversion. Acceptable but worth review |
| G48 | Attribution model | PASS | All advertiser-controlled primaries use `GOOGLE_SEARCH_ATTRIBUTION_DATA_DRIVEN` (DDA). Smart Campaign system actions excluded per audit rules |
| G49 | Conversion value assignment | WARNING | "Start Estimate Request" uses static $1,620 default; "Contact Us" uses $1 (effectively unvalued). No dynamic value rules |
| G-CT1 | No duplicate counting | PASS | Among ENABLED conversion actions, no duplicates of same event source detected (Smart Campaign actions excluded) |
| G-CT2 | GA4 linked and flowing | PASS | GA4-sourced action "Contact Us" is ENABLED and primary; multiple GA4 (web) HIDDEN imports show GA4 link is healthy |
| G-CT3 | Google Tag firing | N/A | Cannot verify via API; recommend manual Tag Assistant check |
| G-CTV1 | CTV Floodlight limitation | N/A | No CTV campaigns |

**Note on conversion-action sprawl:** 33 total conversion actions exist (many REMOVED/HIDDEN from older agencies and CRO tests). Only 6 are ENABLED, of which 4 are Smart Campaign system-managed. Archive/clean is cosmetic but recommended.

---

### Wasted Spend / Negatives (20% weight) — 61/100

| ID | Check | Result | Evidence |
|---|---|---|---|
| G13 | Search-term audit recency | WARNING | 19 search-term `EXCLUDED` events visible in last 30d (negatives being added) but cadence unclear; no shared-list refresh |
| G14 | Negative keyword lists exist | FAIL | 0 shared negative keyword lists. Only 1 shared set exists (BRANDS type, "CPC - Tesla Repair Brand List") with 0 references |
| G15 | Account-level negatives applied | FAIL | 0 `campaign_shared_set` records; no shared lists attached to any campaign |
| G16 | Wasted spend on irrelevant terms | PASS (borderline) | Only 4 search terms with >$10 cost & 0 conversions (~$47 total = 1.5% of $3,049 active spend) |
| G17 | Broad match + Smart Bidding | PASS | All 97 ENABLED BROAD keywords run on MAXIMIZE_CONVERSIONS Search or Smart Campaign — none on Manual CPC. Legacy BMM heuristic clears |
| G18 | Close variant pollution | WARNING | Multiple `NEAR_EXACT` close-variant matches appearing on terms like "best collision center near me," "cheap body shop," "tesla repair shop" |
| G19 | Search-term visibility | PASS | $879 in 500 visible search-term rows of $3,049 active spend = ~29%, but Smart Campaign hides most of its STs by design. Excluding Smart Campaign, visibility is ~37% — acceptable |
| G-WS1 | Zero-conv keywords (>100 clicks) | PASS | Highest no-conv keyword has 117 clicks on broad term "EV collision repair specialists" — only 1 such case |

**Top wasted search terms (>$10, 0 conv, 30d):**

| Term | Cost | Clicks |
|---|---|---|
| calipers collision | $13.20 | 2 |
| tedesco auto body new rochelle (brand!) | $12.01 | 1 |
| car paint shops near me | $11.57 | 3 |
| auto body shops near me | $10.20 | 4 |

Brand-term "tedesco auto body new rochelle" costing $12 with no recorded conversion is suspicious — likely a known customer where conversion did not fire. Investigate brand attribution.

**Negative keyword footprint (campaign-level, no shared lists):**

| Campaign | Negs |
|---|---|
| Insurance-Focused Family Commuter | 506 |
| Quality-Driven Luxury Owner | 506 |
| Budget-Conscious Urban Driver | 506 |
| EV Owners | 506 |
| Smart (Auto Body and Collision Repair Tesla Rivian) | 502 |

Each persona campaign carries 506 identical negatives — perfect candidate for consolidation into 1–3 shared lists.

---

### Account Structure (15% weight) — 63/100

| ID | Check | Result | Evidence |
|---|---|---|---|
| G01 | Campaign naming convention | WARNING | Mixed — new persona campaigns use plain English ("Insurance-Focused Family Commuter"); legacy use `CHANNEL \| GOAL \| GEO \| BID` ("SEARCH \| LEADS - SERVICE \| 20 MILES \| CPC"). No single convention |
| G02 | Ad group naming convention | PASS | Within active campaigns, ad groups follow consistent theme labels (Brand–Tesla, EV Collision–Core, Location–Westchester) |
| G03 | Single-theme ad groups | PASS | Ad groups have 1–5 keywords with impressions each, all thematically tight |
| G04 | Campaign count per objective | PASS | 4 persona Search + 1 Smart for one lead-gen objective = 5; within ≤5 threshold |
| G05 | Brand vs Non-Brand separation | WARNING | EV Owners campaign contains "Brand – Tesla," "Brand – Rivian," "Brand – Porsche," "Brand – Polestar" ad groups mixing brand & non-brand. Not a fully dedicated brand campaign |
| G06 | PMax present | FAIL | 2 PMax campaigns exist but both PAUSED ("Local - Performance Max Campaign," "Performance Max Test"). Asset groups POOR strength |
| G07 | Search + PMax overlap | N/A | No active brand Search and no active PMax |
| G08 | Budget allocation matches priority | PASS | Persona campaigns each set to $20/day; spend distributed evenly (~$590–$606), no clear underfunding of top performer |
| G09 | Daily budget vs spend | PASS | No evidence of mid-day exhaustion |
| G10 | Ad schedule configured | FAIL | No ad schedule criteria found at campaign or account level. Body shop typically has weekday business hours preferences |
| G11 | Geographic targeting accuracy | FAIL | All 4 ENABLED Search campaigns set `positive_geo_target_type = PRESENCE_OR_INTEREST`. For a local body shop in NY this leaks spend to out-of-market searchers who merely "show interest" in NY locations. **Quick win.** |
| G12 | Network settings | WARNING | All persona Search campaigns: `target_search_network = false` (Search Partners OFF). Content network correctly off. Per accuracy notes, Search Partners OFF is a missed-opportunity WARN, not FAIL |

---

### Keywords & Quality Score (15% weight) — 48/100

| ID | Check | Result | Evidence |
|---|---|---|---|
| G20 | Average Quality Score | FAIL | Only 3 of 30 served keywords have a QS assigned (QS 3, 5, 5). 27 served keywords have QS = 0 (not yet computed by Google = too little data). Effective avg QS ~4.3 across measurable kw |
| G21 | Critical QS keywords (≤3) | PASS | Only 1 keyword with QS ≤3 ("Polestar collision repair" at QS 3, 1 impression). <10% |
| G22 | Expected CTR component | PASS (small sample) | 2 of 3 measured kw are ABOVE_AVERAGE expected CTR |
| G23 | Ad relevance component | FAIL | 2 of 3 measured kw are BELOW_AVERAGE ad relevance (67%) |
| G24 | Landing page experience | FAIL | 3 of 3 measured kw are BELOW_AVERAGE landing page experience (100%). Landing page is `www.tedescoautobody.com` homepage for every ad group |
| G25 | Top-20 spend keyword QS | FAIL | Of top-20 spend keywords, max QS is 5; most show QS 0 (insufficient data). None ≥7 |
| G-KW1 | Zero-impression keywords | FAIL | 67 / 97 = **69%** of ENABLED keywords had 0 impressions in 30d. Indicates over-stuffed keyword lists or low search volume |
| G-KW2 | Keyword-to-ad relevance | PASS | RSA headlines reference auto body, collision, EV, etc. — themed to ad groups (sampled) |

**Critical insight:** Landing page experience is BELOW_AVERAGE on every keyword for which Google has data. Persona-specific landing pages (Insurance, Luxury, Budget, EV) would dramatically improve QS and LP relevance (G24, G60).

---

### Ads & Assets (15% weight) — 46/100

| ID | Check | Result | Evidence |
|---|---|---|---|
| G26 | RSA per ad group | PASS | Each ENABLED ad group has 3 RSAs (≥1 required, ≥2 recommended) |
| G27 | RSA headline count | FAIL | **All 66 RSAs have exactly 5 headlines** (recommended ≥8, ideal 12–15) |
| G28 | RSA description count | PASS | All RSAs have 4 descriptions (ideal=4) |
| G29 | RSA Ad Strength | FAIL | **56 of 66 (85%) RSAs = POOR**, 10 AVERAGE, 0 GOOD or EXCELLENT |
| G30 | Pinning strategy | N/A | Pin metadata not pulled |
| G31–G34 | PMax asset density/video/groups/URL expansion | N/A | All PMax campaigns are PAUSED; 2 asset groups exist, both POOR ad strength |
| G35 | Ad copy relevance to keywords | WARNING | Sampled ad copy themed to ad group but with only 5 headlines, limited variant coverage |
| G-AD1 | Ad freshness | PASS | Persona campaigns recently launched; all RSAs created within last 90d |
| G-AD2 | CTR vs benchmark | PASS (borderline) | Persona campaign blended CTR 3.37%. Local Services benchmark 5.5–6.4% — Tedesco at ~50–60% of benchmark. Smart Campaign 3.26% on 66,538 impressions also low |
| G-PM1 to G-PM6 | PMax checks | N/A | PMax campaigns PAUSED |
| G-AI1 | AI Max for Search evaluated | FAIL | No AI Max settings observed. Account has 70 conv/30d + strong negative footprint — qualifies for evaluation |
| G-DG1 to G-DG3 | Demand Gen / VAC migration | N/A | No Demand Gen or Video Action Campaigns present |

---

### Settings & Targeting (10% weight) — 47/100

| ID | Check | Result | Evidence |
|---|---|---|---|
| G50 | Sitelink extensions | FAIL | 4 persona Search campaigns have **no campaign-attached sitelinks**. Smart Campaign has 7 attached. Account-level customer_asset sitelinks exist (6) but no automatic application to persona campaigns confirmed |
| G51 | Callout extensions | PASS | 10 callouts at account level (`customer_asset` ENABLED) |
| G52 | Structured snippets | PASS | 1 structured snippet at account level |
| G53 | Image extensions | FAIL | No `IMAGE` field_type asset on customer_asset or campaign_asset |
| G54 | Call extensions | PASS | 1 CALL asset at account level + 1 attached to Smart Campaign |
| G55 | Lead form extensions | FAIL | No `LEAD_FORM` field_type asset |
| G56 | Audience segments applied | FAIL | Only 19 USER_INTEREST criteria across all campaigns — none on the 4 persona Search campaigns based on campaign-criterion breakdown |
| G57 | Customer Match | FAIL | No Customer Match user list attached |
| G58 | Placement exclusions | FAIL | 0 negative LOCATION/placement criteria. No account-level placement exclusion (games, MFA, etc.) found |
| G59 | LP mobile speed | N/A | Cannot test via API |
| G60 | LP relevance | N/A | Cannot test via API; G24 indicator suggests low |
| G61 | LP schema markup | N/A | Cannot test via API |
| G36 | Smart bidding active | PASS | All 4 ENABLED Search campaigns use MAXIMIZE_CONVERSIONS; Smart uses TARGET_SPEND |
| G37 | Target CPA reasonableness | WARNING | No tCPA target set (using Max Conv without target). CPAs vary $57–$135 across personas. Recommend setting tCPA after 30 more days of data |
| G38 | Learning phase status | WARNING | Cannot directly query learning state, but persona campaigns are recent and 4.5–10.5 conv/30d each — under the 15-conv-per-30d threshold for stable Smart Bidding |
| G39 | Budget-constrained campaigns | PASS | No "Limited by Budget" flag observed; spend tracking close to budget |
| G40 | Manual CPC justification | PASS | No ENABLED Manual CPC campaigns |
| G41 | Portfolio bid strategies | WARNING | 4 personas run independent strategies despite each having <15 conv/month. Pooling into a portfolio Max Conv strategy would accelerate learning |

---

## Wasted Spend Estimate

- **Active monthly spend:** $3,049
- **Estimated waste (terms >$10 with 0 conv):** ~$47/mo (1.5%) — low
- **Estimated waste from PRESENCE_OR_INTEREST geo:** Hard to bound without geo report, but flipping to PRESENCE typically recovers 5–15% on local Search → $150–$450/mo potential
- **Estimated brand-term waste:** $12 in "tedesco auto body new rochelle" with 0 attributed conversions in 30d — investigate; brand search should convert near 100%
- **Likely largest leak:** 56 POOR RSAs and 3/3 BELOW_AVERAGE landing-page scores are dragging CPC up across all campaigns (high QS = up to 50% CPC discount). Not a "term waste" line item but the largest hidden cost

**Top 10 highest-spend search terms (30d):**

| Term | Match | Cost | Clicks | Conv |
|---|---|---|---|---|
| calipers collision | BROAD | $13.20 | 2 | 0 |
| tedesco auto body new rochelle | BROAD | $12.01 | 1 | 0 |
| car paint shops near me | BROAD | $11.57 | 3 | 0 |
| car paint quote | BROAD | $10.72 | 1 | 0.5 |
| auto body shops near me | BROAD | $10.20 | 4 | 0 |
| auto body shop queens | BROAD | $9.12 | 2 | 0 |
| auto body shop near me | BROAD | $8.43 | 10 | 0 |
| auto body shop near me | BROAD | $7.84 | 8 | 0 |
| best collision center near me | NEAR_EXACT | $7.56 | 1 | 0 |
| body shops near me | BROAD | $7.44 | 8 | 0 |

---

## PMax Findings

Two PMax campaigns exist, **both PAUSED**:
- `Local - Performance Max Campaign` (campaign 16884519079) — asset_group "Porsche and Tesla" — Ad Strength POOR
- `Performance Max Test` (campaign 18134891506) — asset_group "Asset Group 1" — Ad Strength POOR

Both share `https://www.tedescoautobody.com` as final URL. Asset group "Asset Group 1" name suggests it was never customized.

**Recommendation:** Either retire (since unused) or rebuild with proper asset density (≥20 images, ≥5 logos, ≥5 native videos), add 2nd intent-segmented asset group per campaign, and re-enable. PMax for local body shops typically performs well.

---

## AI Max / Demand Gen

| Check | Status |
|---|---|
| G-AI1 AI Max for Search | **Not evaluated.** Account meets eligibility (≥50 conv/month combined Smart + Search; 506-keyword negative list per persona campaign). Test on one persona campaign |
| G-DG1 Demand Gen image assets | N/A — no DG campaigns |
| G-DG2 VAC → DG migration | N/A — no VACs detected |
| G-DG3 DG frequency capping loss | N/A |

---

## G-SYS1 Diagnostic

**Failed fetches:**
- `campaign` initial query failed on `campaign.start_date` / `campaign.end_date` (unrecognized fields in API v20). Retried without those fields — succeeded.
- `ad_group_criterion` direct query failed on metrics fields (clicks/cost_micros). Refetched via `keyword_view` resource — succeeded.

**Skipped (cannot evaluate via API alone):**
- G-CT3 Google Tag firing — needs Tag Assistant
- G30 RSA pinning strategy — pin fields not in initial pull
- G59 LP mobile speed — needs PageSpeed
- G60 LP relevance — needs HTML inspection (signal: G24 LP-experience below avg suggests FAIL)
- G61 LP schema markup — needs HTML inspection

**Resources fully pulled:** customer, campaign, campaign_budget, conversion_action, ad_group, keyword_view (97 rows), ad_group_ad (70), search_term_view (500 of LAST_30_DAYS top by cost), campaign_criterion (3,065), shared_set, campaign_shared_set, campaign_asset, customer_asset, asset_group.

**Resources not pulled:** change_event (deferred — not needed to score), asset_group_signal / asset_group_asset (PMax PAUSED, low value).

---

## Action Plan (next 30 days)

### Week 1 — Critical / Quick Wins (target: +10 pts)
1. **G11 (2 min):** Change all 4 persona Search campaigns from `PRESENCE_OR_INTEREST` to `PRESENCE`
2. **G14/G15 (15 min):** Create 4–5 themed shared negative lists (Jobs/Careers, DIY, Cheap-info, Insurance-info, Competitors) and attach to all 5 active campaigns. Decommission per-campaign duplicates
3. **G50 (10 min):** Attach 4+ sitelinks to each persona Search campaign. Reuse the 6 ENABLED customer_asset sitelinks if relevant; create new if not
4. **G45 (1 hr w/ dev):** Implement Consent Mode v2 (advanced) on tedescoautobody.com
5. **G16 follow-up:** Investigate why "tedesco auto body new rochelle" brand term recorded 0 conversions despite $12 spend — likely Smart Campaign attribution gap

### Week 2 — Ads & Quality Score (target: +5 pts)
6. **G27/G29 (1 evening):** Rebuild every RSA on persona campaigns with 12–15 headlines and 4 descriptions. Use 2–3 pinned positions max
7. **G24/G60 (2–5 days):** Build 4 persona-specific landing pages (Insurance, Luxury, Budget, EV) to lift below-average LP experience
8. **G53 (15 min):** Add image extensions (shop photos, before/after, certifications)
9. **G-KW1 (30 min):** Prune the 67 zero-impression keywords; reduce list to high-intent terms only

### Week 3 — Audiences & Targeting
10. **G56 (30 min):** Apply in-market "Auto Body Repair & Maintenance," "Auto Insurance," and remarketing all-visitors audience in **Observation** mode on every persona campaign
11. **G57 (1 hr):** Upload Customer Match list from CRM/insurance referrals; refresh monthly
12. **G58 (15 min):** Add account-level placement exclusions (mobile games, MFA sites, sensitive content)
13. **G5/G7:** Split brand-keyword ad groups (Brand–Tesla, Brand–Rivian, Brand–Porsche, Brand–Polestar) out of EV Owners into a dedicated brand-only campaign

### Week 4 — Bidding, PMax & AI Max
14. **G37 (15 min):** Once each persona campaign has 30+ conversions, set tCPA at 1.1× current actual CPA
15. **G41 (15 min):** Move all 4 personas into a single Portfolio Max Conv strategy so they share learning signal
16. **G6:** Decide on PMax — either retire the 2 paused campaigns or rebuild Local PMax with proper asset density and re-enable
17. **G-AI1:** Enable AI Max for Search on the Quality-Driven Luxury Owner campaign as a pilot (highest AOV, most negatives in place)
18. **G47/G49:** Reconfirm "Contact Us" as primary; assign dynamic conversion values (Tesla repair = $X, dent = $Y, EV collision = $Z) instead of flat $1,620

### Ongoing
- Weekly search-term review (G13) → push new negatives into shared lists
- Monthly: rotate 2–3 RSA headlines per ad group (G-AD1)
- Quarterly: customer-match list refresh (G57)
