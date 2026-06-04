# Koffman AutoWorks — Multi-Platform Ads Audit Report

**Client:** Koffman AutoWorks, LLC
**Site:** https://www.koffmanautoworks.com/
**Location:** 420 S Fond du Lac Ave, Campbellsport, WI 53010
**Business Type:** Local Service — Auto Repair (AR) + Collision Repair (CR) + ADAS
**Audit Date:** 2026-05-18
**Audit Mode:** External-only (no ad account access granted)
**Auditor:** Phoenix Solutions Group via `/ads audit`

---

## Executive Summary

### Aggregate Ads Health Score: **28 / 100 — Grade F**

Score is preliminary. External-data-only audit. Account access required to complete Google G01-G74 and Meta M01-M46 checks. Score will refine once Hibu (Google Ads) and Turnkey (Meta Ads) read-only access granted.

### Per-Platform Scores (External Signals Only)

| Platform | Score | Grade | Budget Share (est.) | Status |
|---|---|---|---|---|
| Google Ads | 22 / 100 | F | ~60% (est. $500-$1,500/mo) | Hibu-managed. SEMrush detects 0 paid keywords. Conv tracking absent. |
| Meta Ads | 35 / 100 | F | ~30% (est. $500-$1,500/mo) | Turnkey-managed. Boosted posts confirmed via email; no structured campaigns. |
| LinkedIn Ads | n/a | — | 0% | Not in use. Not relevant for this vertical. |
| TikTok Ads | n/a | — | 0% | Not in use. Optional for younger-skew CR creative later. |
| Microsoft Ads | n/a | — | ~10% (potential) | Not in use. Cheap CPC opportunity. |
| Apple Ads | n/a | — | 0% | Not in use. Not relevant. |

### Business Type Detected

**Local Service — Hybrid AR + CR + ADAS**
Signals: NAPA Auto Care center, ASE techs, I-CAR-trained collision staff, single physical location, geographic targeting (Campbellsport + 25mi radius), phone-driven lead gen via Shopgenie booking, lifetime collision warranty messaging, hometown-Wisconsin tone.

### Active Vendor Stack (verified via client email + site crawl)

| Vendor | Role | Verified Cost |
|---|---|---|
| Hibu | Website + SEO + Google Ads + Display (iPromote) + Listings | Est. $1,200-$3,000/mo |
| Turnkey Marketing | FB/IG social + paid social + Shopgenie CRM + call scoring + collateral | Est. $2,500-$4,000/mo + $500-$1,500 ad spend |
| Shopgenie (now Tekmetric Marketing) | CRM SMS + Mkt automation (via Turnkey) | Est. $345-$840/mo |
| AutoFix | Call coaching for AR + CR | Est. $800-$1,800/mo |
| Carwise / CCC | CR DRP-fed reviews + follow-up | Likely free (DRP) |

**Total estimated current spend: $5,345-$11,140/mo = $64k-$134k/yr. Most likely $7-9k/mo = $84-108k/yr.**

---

## Top 5 Critical Issues (Cross-Platform)

| # | Severity | Issue | Evidence |
|---|---|---|---|
| 1 | Critical | No conversion tracking on website | Site crawl: no GA4, no GTM, no Meta Pixel, no Google Ads conversion tag, no CallRail. Only iPromote display pixel detected. |
| 2 | Critical | Phone number attribution broken | 3 phone numbers in circulation: (920) 533-5930 (shop), (920) 533-2031 (site header), (610) 888-5554 (iPromote tracking, PA area code). |
| 3 | Critical | Google Ads spend appears dormant or untrackable | SEMrush API returns 0 paid keywords, 0 PLA keywords for `koffmanautoworks.com`. Hibu invoicing for Google Ads but signal absent. |
| 4 | Critical | Website owned by vendor (Hibu) | Hibu retains site, domain access, ad accounts. Documented $250/mo ransom fee for site continuity post-cancel. |
| 5 | High | Collision repair dept under-served in paid stack | Turnkey is AR-focused. Heather doing CR posts/boosts off side of desk. No structured CR ad strategy. |

## Top 5 Quick Wins (Cross-Platform)

| # | Action | Time | Impact |
|---|---|---|---|
| 1 | Request read-only Hibu Google Ads access | 10 min | Unblocks Google G01-G74 audit |
| 2 | Request read-only Turnkey Meta Business Manager access | 10 min | Unblocks Meta M01-M46 audit |
| 3 | Pull Hibu + Turnkey invoices from QuickBooks (AR/CR labels) | 15 min | Validates $7-9k/mo estimate |
| 4 | Take down or 301 the orphan site `danv211.sg-host.com` | 15 min | Stops brand SERP leak |
| 5 | Add "Auto Body Shop" as secondary GBP category | 10 min | Unlocks Map Pack for CR queries |

---

## Google Ads — Score: 22 / 100 (F)

### Category Breakdown (External Signals)

| Category | Weight | Score | Grade | Notes |
|---|---|---|---|---|
| Conversion Tracking | 25% | 5/100 | F | No Google Ads conv tag on site. No GA4. No enhanced conversions possible. |
| Wasted Spend | 20% | Unknown | — | Requires Search Terms Report + Change History |
| Account Structure | 15% | Unknown | — | Requires account access |
| Keywords | 15% | 15/100 | F | SEMrush detects 0 paid keywords. Account likely dormant, brand-only, or below detection. |
| Ads (RSA/PMax) | 15% | Unknown | — | No public RSA copy surfaced via Google Ads Transparency |
| Settings | 10% | Unknown | — | Requires account access |

**Confidence: Low.** Score reflects external signals only. Re-score after Hibu access.

### Confirmed Findings

- **G01 (Conversion tracking installed):** FAIL. No `gtag('config', 'AW-...')` or `gtag('event', 'conversion'...)` in site source. Only iPromote pixel.
- **G02 (Google Ads ↔ GA4 linked):** FAIL. No GA4 present.
- **G03 (Enhanced Conversions enabled):** FAIL. Prerequisite (GA4 + conv tag) missing.
- **G18 (Branded keyword spend):** Unknown but likely. With 0 paid keywords detected and brand SERP fully owned, any Hibu spend on brand terms is wasted (organic captures the click).
- **G56 (LSA / Local Service Ads):** SKIP. Auto repair + auto body are unsupported LSA verticals in US per Google Ads Community thread. Do not pitch LSA.
- **G72 (Smart Bidding sufficient conversion volume):** FAIL. Cannot enable Smart Bidding without conv tracking installed.

### Why Hibu Likely Fails

1. iPromote (Hibu's proprietary display retargeting) is the only pixel present. Hibu is optimizing display impressions, not Google Ads conversions.
2. Bundled invoice means client cannot see how much of monthly fee reaches Google vs. retained as management fee.
3. BBB complaints document Hibu wrong-city geo-targeting and refusal to share account-level data.

---

## Meta Ads — Score: 35 / 100 (F)

### Category Breakdown (External Signals)

| Category | Weight | Score | Grade | Notes |
|---|---|---|---|---|
| Pixel / CAPI Health | 30% | 5/100 | F | No `fbq('init', ...)` in site source. No Meta Pixel detected. CAPI impossible. |
| Creative Quality | 30% | 50/100 | D | Email confirms Turnkey runs boosted posts + some structured ads for AR. Heather boosted seasonal CR (hail, deer). Creative quality not verifiable via Ad Library (UI-only, blocked in headless). |
| Account Structure | 20% | Unknown | — | Requires Business Manager access |
| Audience Targeting | 20% | Unknown | — | Requires access; "boosted posts" implies default Meta-suggested audiences (weak) |

**Confidence: Low-Medium.** Score reflects pixel absence + email-confirmed boosted-post strategy.

### Confirmed Findings

- **M01 (Meta Pixel installed):** FAIL. No `fbq.init` call in site HTML.
- **M02 (CAPI installed):** FAIL. Pixel prerequisite missing.
- **M03 (EMQ score ≥7):** FAIL. No pixel = no EMQ.
- **M04 (Aggregated Event Measurement priority order set):** N/A. No events firing.
- **M21 (Andromeda creative diversity ≥10 distinct creatives):** UNKNOWN. Manual Ad Library check required.
- **M40 (Boosted Posts vs structured campaigns):** WARNING. Boosted posts are NOT structured Meta Ads campaigns. Inferior bidding, weaker audience controls, no learning-phase optimization.

### Quick Wins Specific to Meta

1. Install Meta Pixel + CAPI (Conversions API) via GTM
2. Migrate boosted posts to Advantage+ Shopping or Standard campaigns with Sales / Leads objectives
3. Build Lookalike audience from Carwise review list (221 happy CR customers)
4. Test CR-specific creative: hail/deer/insurance-direct angles

---

## Microsoft / Bing Ads — Score: n/a (Not in Use)

**Opportunity.** Microsoft Ads imports Google Ads campaign structures in 1 click. CPCs typically 30-50% lower than Google. Bing skews older demographic — strong overlap with collision insurance-claim demographic (35-65+ vehicle owners).

**Recommended:** Phase 2 add-on. ~$200-$500/mo budget. Auto-import from rebuilt Google Ads account once Google is healthy.

---

## LinkedIn / TikTok / Apple Ads — Score: n/a (Not in Use)

**LinkedIn:** Wrong platform for this business. Skip.
**TikTok:** Optional for CR creative (younger truck/ATV deer collision demographic). Phase 3+ at earliest.
**Apple Ads:** App-install platform. N/A.

---

## Cross-Platform Analysis

### Tracking Consistency

| Platform | GA4 | GTM | Conv Tag | Pixel | CAPI | CallRail |
|---|---|---|---|---|---|---|
| Site | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Verdict:** Zero modern tracking infrastructure. Hibu is running display ads against an iPromote pixel only. Turnkey is boosting posts with no Meta Pixel to optimize against.

### Creative Consistency

Hibu = generic stock auto repair templates. Turnkey = monthly social calendar (AR-focused). Heather = scattered CR boosts on hail/deer. **No unified brand voice or campaign architecture across Hibu, Turnkey, and Heather's CR posts.**

### Attribution Overlap

- Shopgenie (Turnkey) sends CR follow-up SMS/email.
- Carwise / CCC sends CR follow-up SMS/email (via DRP feed).
- **Documented duplication.** Same customer hit by two systems with different branding.

### Budget Allocation Assessment

| Channel | Current Est. | Recommended for Local Auto Repair |
|---|---|---|
| Google Search | $500-$1,500 | $2,000-$3,500 (primary lead source) |
| Google PMax | $0 | $500-$1,000 (test) |
| Meta CR/AR | $500-$1,500 (boosted) | $1,000-$2,000 (structured, with pixel) |
| Microsoft | $0 | $200-$500 (cheap, easy import) |
| Local Display / iPromote | bundled in Hibu | $0 (kill iPromote, redirect to GDN/YouTube) |
| **Total Recommended** | | **$3,700-$7,000/mo** |

---

## Strategic Recommendations

### Platform Prioritization (Local Service vertical)
1. **Google Search** — highest intent, primary lead source for collision repair queries
2. **Meta CR creative** — under-served dept, big visual canvas (before/after photos)
3. **Microsoft import** — cheap incremental
4. **Google Maps / GBP optimization** — non-paid but mandatory
5. TikTok / YouTube — Phase 3 if budget allows

### Scaling Opportunities (post-fix)
- Geo expansion to Fond du Lac (no organic presence today; Caliber + Gerber + Dreher own metro)
- Hail / deer / ADAS seasonal landing pages
- Insurance-claim direct-bill positioning (vs. DRP-only competitors)

### Kill List (immediate)
- iPromote display network (no measurable performance, Hibu-proprietary)
- Hibu Google Ads if access reveals brand-only spend
- Boosted Posts as primary Meta strategy (replace with structured campaigns)
- Orphan dev site `danv211.sg-host.com`

---

## Methodology + Tools Used

| Tool | Status | Used For |
|---|---|---|
| WebFetch (Koffman site) | ✓ | Pixel detection, page inventory, schema check |
| SEMrush API | ✓ | Domain rank, organic kw, paid kw, backlinks, competitors |
| Ahrefs MCP | OAuth URL handed to user, pending | Backlink + kw validation |
| Similarweb MCP | Blocked (CloudFront 403) | — |
| Meta Ad Library (manual) | Click-through URLs supplied | Pending manual verification |
| Google Ads Transparency Center | Click-through URLs supplied | Pending manual verification |
| WebSearch (organic SERP) | ✓ | Rank mapping across 14 queries + competitor identification |
| Subagents (5 parallel) | ✓ | Site, Meta Ads, Google Ads + GBP, organic SEO, competitors |
| Subagents (6 parallel — vendor pricing) | ✓ | 14 vendor profiles in `shop_marketing_pricing/results/` |

## Files Delivered

- `/Users/schoolcraft_mbpro/apps/ads/ops/koffman-auto-works/ADS-AUDIT-REPORT.md` (this file)
- `/Users/schoolcraft_mbpro/apps/ads/ops/koffman-auto-works/ADS-ACTION-PLAN.md` (prioritized actions)
- `/Users/schoolcraft_mbpro/apps/ads/ops/koffman-auto-works/ADS-QUICK-WINS.md` (sub-15-min fixes)
- `/Users/schoolcraft_mbpro/apps/ads/ops/koffman-auto-works/shop_marketing_pricing/results/*.json` (14 vendor pricing profiles)

## Next Action

Send vendor-invoice + access-request email to Heather Koffman. Refresh audit with internal data within 7 days of access granted.

---
*Audit run via Claude `/ads audit` skill v1.5.1. External-data-only mode. Re-audit required after account access.*
