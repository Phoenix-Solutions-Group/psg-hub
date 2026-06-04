# Wallace Collision Center — Google Ads Handoff
**Account:** 604-861-1995 (customer_id: 6048611995)  
**Agency:** Phoenix Solutions Group  
**Date:** 2026-05-06  
**Status:** Campaigns built and PAUSED — awaiting client review + activation  

---

## What Was Built

5 Google Search campaigns created via API, all PAUSED. Nothing is spending.

| Campaign | ID | Budget | Bidding | Geo | Ad Groups | Keywords |
|----------|----|--------|---------|-----|-----------|----------|
| `GOOG_WAL_SRCH_Brand_2026Q2` | 23825006324 | $7/day | Target IS 90% | 40mi LOP | 1 | 5 |
| `GOOG_WAL_SRCH_LocalCollision_2026Q2` | 23829477511 | $40/day | Max Conversions | 40mi LOP | 5 | 31 |
| `GOOG_WAL_SRCH_ToyotaCertified_2026Q2` | 23819659089 | $13/day | Target Spend $8 cap | 75mi LOP | 3 | 21 |
| `GOOG_WAL_SRCH_TeslaApproved_2026Q2` | 23825006339 | $5/day | Manual CPC $20 | 75mi LOP | 1 | 7 |
| `GOOG_WAL_SRCH_JLRCertified_2026Q2` | 23819664216 | $3/day | Manual CPC $25 | 75mi LOP | 1 | 8 |

**Total daily budget:** $68/day ($2,040/month)  
**Remaining $4K budget:** Meta, brand protection, LSA setup (see ADS-STRATEGY.md)

**All geo:** Kingsport, TN — PRESENCE only (users physically in area, not area-of-interest)

---

## Before Enabling — Required Actions

### P0 — Blocking (do before any campaign goes live)

- [ ] **Fix conversion tracking** — run `fix_conversion_actions.py` and `fix_qualify_lead_category.py`. Nothing should be enabled until Smart Bidding has a real signal.
- [ ] **Confirm Toyota Collision Care certification is current** — Toyota campaign is Priority #1. If cert lapsed, pause Toyota before enabling.
- [ ] **Verify domain URLs exist:**
  - `wallacecollisionrepair.com/collision-repair/` — must resolve
  - `wallacecollisionrepair.com/toyota-certified/` — **must be built before Toyota goes live**
  - `wallacecollisionrepair.com/tesla-approved/` — must exist
  - `wallacecollisionrepair.com/jaguar-land-rover-certified/` — must exist

### P1 — Do Before Week 2

- [ ] **Replace ad copy placeholders** — RSAs contain `[YEAR]` and `[X]` in headlines/descriptions. Fix in Google Ads UI: Ads → edit each RSA.
- [ ] **Add call assets** — phone number + business hours on every campaign
- [ ] **Add location assets** — link Google Business Profile(s)
- [ ] **Add sitelink extensions:**
  - Free Estimate → /estimate (or /collision-repair/)
  - Insurance Accepted → /insurance
  - Toyota Certified → /toyota-certified/
  - Lifetime Warranty → /warranty
- [ ] **Add callout assets:** "I-CAR Gold Class," "OEM Certified Repairs," "Lifetime Warranty," "All Insurers Accepted," "Free Estimates," "Rental Assistance"
- [ ] **Apply for Google LSA** (Local Services Ads) — separate from these campaigns, $1,600/month budget allocation in plan. Go to ads.google.com/local-services-ads.

### P2 — Do Before Month 2

- [ ] Set up Meta Pixel via GTM
- [ ] Launch Meta retargeting campaigns (see ADS-STRATEGY.md)
- [ ] Set up CallRail or Google forwarding numbers
- [ ] Separate Wallace Ford brand campaign into its own account

---

## Activation Sequence

Enable one at a time. Do NOT enable all simultaneously.

```
Day 1:  Enable Brand
Day 3:  Enable LocalCollision (after confirming conversion tracking works)
Day 7:  Enable Toyota (after /toyota-certified/ landing page is live)
Day 14: Enable Tesla + JLR (after certified landing pages live)
```

**How to enable:** Google Ads UI → Campaigns → filter "Paused" → click status toggle → Enabled.

---

## Known Issues Fixed During Build

| Issue | Fix Applied |
|-------|------------|
| `contains_eu_political_advertising` required field | Set to `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` enum |
| `maximize_clicks` wrong field name | Renamed to `target_spend` (Google Ads API v23) |
| `location_groups` wrong on CampaignCriterion | Moved LOP setting to campaign-level `geo_target_type_setting` |
| LocalCollision ad groups had $0.01 max CPC | Set to $50 ceiling (effectively unconstrained for Maximize Conversions) |
| 3 orphaned budgets from failed attempts | All deleted via API |
| 1 partial Brand campaign from failed attempt | Deleted via API (shows as REMOVED ghost — ignore) |

---

## Files in This Directory

| File | Purpose |
|------|---------|
| `ADS-STRATEGY.md` | Full strategy with SEMRush data, platform mix, competitive intel |
| `MASTER-PLAN.md` | Consolidated master plan — start here |
| `CAMPAIGN-ARCHITECTURE.md` | Naming conventions, ad group structure, negative keyword lists |
| `BUDGET-PLAN.md` | Phase 1/2/3 budgets ($4K → $6K → $10K), scaling rules, ROI projections |
| `CREATIVE-BRIEF.md` | Full RSA headline banks, Meta creative specs, landing page requirements |
| `TRACKING-SETUP.md` | Step-by-step conversion fix, LSA setup, Meta pixel, CallRail |
| `IMPLEMENTATION-ROADMAP.md` | Day-by-day checklist across 5 phases |
| `TOYOTA-CAMPAIGN.md` | Toyota-specific keyword strategy, competitive intel vs. Toyota of Kingsport |
| `create_campaigns.py` | API script that built the campaigns — reusable for future changes |
| `fix_conversion_actions.py` | **Run this first** — fixes broken conversion tracking |
| `fix_qualify_lead_category.py` | Promotes qualify_lead to primary conversion signal |
| `gtm-import.json` | GTM container import for tracking setup |

---

## Open Client Decisions

| # | Decision | Blocks |
|---|----------|--------|
| 1 | Toyota Collision Care cert is current? | Toyota campaign activation |
| 2 | PSG executes directly or proposes only? | All ongoing changes |
| 3 | DMS for offline RO import (CCC ONE, Mitchell, Audatex)? | Offline conversions |
| 4 | Website CMS — can we install GTM? | Meta + tracking |
| 5 | CallRail budget approved ($60–100/month)? | Cross-channel attribution |
| 6 | Wallace Ford — separate account now or defer? | Account structure |
| 7 | Target cost per booked repair order? | tCPA target setting |
| 8 | Creative assets — who shoots before/after + testimonials? | Meta creative |
| 9 | Multiple locations — all addresses + hours? | LSA, location assets |

---

## Quick Links

- **Google Ads account:** https://ads.google.com/aw/campaigns?__e=6048611995
- **Run tracking fix:** `cd /Users/schoolcraft_mbpro/apps/ads && .venv/bin/python ops/wallace/fix_conversion_actions.py --dry-run`
- **Re-audit campaigns:** `cd /Users/schoolcraft_mbpro/apps/ads && .venv/bin/python ops/wallace/create_campaigns.py --dry-run` (will show existing — use for verification)
- **Or via -m:** `python -m ops.wallace.fix_conversion_actions --dry-run`

---

*PSG · Wallace Collision Center · 2026-05-06*
