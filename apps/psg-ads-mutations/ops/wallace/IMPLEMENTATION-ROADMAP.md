# Wallace Collision — Implementation Roadmap
**Date:** 2026-05-06

---

## Overview

| Phase | Timeline | Focus | Budget |
|-------|----------|-------|--------|
| 1. Foundation | Days 1–14 | Tracking fix, LSA setup, Meta pixel | $4,000/mo |
| 2. Rebuild | Days 15–30 | Toyota campaign launch, campaign restructure, Meta | $4,000/mo |
| 3. Stabilize | Days 31–60 | QS improvement, bidding migration | $4,000/mo |
| 4. Scale | Days 61–90 | Budget increase, expand platforms | $6,000/mo |
| 5. Grow | Month 4–6 | Multi-location expansion, Meta full-funnel | $8–10K/mo |

---

## Phase 1 — Foundation (Days 1–14)

**Goal:** Fix measurement. Nothing can be optimized until tracking is clean.

### Week 1 (Days 1–7)
- [ ] Fix Google Ads conversion actions (demote Landing Page, fix Form counting, unhide qualify_lead)
- [ ] Verify call duration threshold = 60 seconds on "Calls from ads"
- [ ] Begin Google LSA application — submit documentation for Google Guaranteed
- [ ] Install Meta Pixel via GTM (or directly if no GTM)
- [ ] Configure Meta pixel events: PageView, Lead, Contact
- [ ] Set up CallRail account + tracking numbers (optional but recommended)
- [ ] Audit all Google Business Profile listings for completeness + verification

### Week 2 (Days 8–14)
- [ ] Verify GA4 qualify_lead event is firing on form submits
- [ ] Import GA4 qualify_lead into Google Ads as primary conversion
- [ ] Confirm Calls from ads tracking is working (test call, verify in account)
- [ ] LSA application follow-up — Google Guaranteed badge typically takes 3–10 days
- [ ] Build 300+ entry negative keyword lists (see CAMPAIGN-ARCHITECTURE.md)
- [ ] Pause worst-performing search terms in Tesla/JLR campaigns (hold campaigns live, just prune terms)

**Week 2 checkpoint:** Smart Bidding should be receiving clean lead signals. If conversion count drops from ~2,162 "conversions"/month to 20–60 real leads — that is expected and correct. Do not panic.

---

## Phase 2 — Rebuild (Days 15–30)

**Goal:** Rebuild campaign structure. Launch Toyota. Launch Meta. Get LSA live.

### Week 3 (Days 15–21)
- [ ] Create new ad group structure in Core Local campaign (5 themed ad groups — see CAMPAIGN-ARCHITECTURE.md)
- [ ] Write 3 RSAs per ad group (use copy from CREATIVE-BRIEF.md)
- [ ] **Build /toyota-certified/ landing page** — prerequisite for Toyota campaign
- [ ] **Launch GOOG_WAL_SRCH_ToyotaCertified_2026Q2** — Ad Group 1 (certified intent) first
- [ ] **Set Toyota campaign max CPC at $8** (SEMRush confirms $2.62–$3.82 actual CPC — not $15–18)
- [ ] Rebuild Tesla Approved campaign: tighten keywords to exact/phrase only, apply negatives
- [ ] Rebuild JLR Certified campaign: same approach
- [ ] Add all extensions — sitelinks must include Toyota Certified → /toyota-certified/
- [ ] Switch Tesla + JLR to Manual CPC (remove from Max Conversions until tracking is proven)
- [ ] **LSA goes live** (if Google Guaranteed approved)

### Week 4 (Days 22–30)
- [ ] **Add Toyota model-specific ad group** (Tacoma, RAV4, Tundra, 4Runner, Highlander, Camry)
- [ ] **Add Toyota dealer conquest ad group** (Toyota of Kingsport, Toyota of Bristol terms)
- [ ] Launch Meta retargeting campaigns (website visitors 30-day + high-intent page visitors)
- [ ] **Launch Meta Toyota owner audience** (Toyota vehicle interest targeting, 75-mile radius)
- [ ] Launch Meta local awareness campaign (20-mile radius, homeowners 28–65)
- [ ] Source creative assets: Toyota certification badge photos, before/after on Toyota models
- [ ] Request testimonial video shoots (include Toyota owner testimonial if available)
- [ ] Separate Wallace Ford campaign into its own Google Ads account

**Week 4 checkpoint:** Check LSA lead quality — dispute any invalid leads immediately for credit. Check Meta pixel events are attributing correctly.

---

## Phase 3 — Stabilize (Days 31–60)

**Goal:** Improve Quality Scores. Migrate bidding. Let learning phase complete.

### Month 2 Actions
- [ ] Analyze search term reports — add negatives weekly (ongoing)
- [ ] A/B test RSA headlines — pin underperforming headlines and test replacements
- [ ] Monitor Core Local campaign: if ≥15 conversions in month → switch to Maximize Conversions
- [ ] Monitor Tesla/JLR: if clean leads are flowing → switch from Manual CPC to tCPA at $150 ceiling
- [ ] Review call recordings weekly — assess lead quality and call handling
- [ ] Begin collecting offline conversion data if DMS export is available
- [ ] Add Meta audience: Lookalike from website visitors (requires 100+ pixel events first)
- [ ] Client creative shoot: before/after photos and testimonial videos (needed by Day 45)

**Month 2 checkpoint:** Average QS should be improving from 3–4 toward 5–6. CPL should be dropping from learning-phase highs toward $75–90 target.

---

## Phase 4 — Scale (Days 61–90)

**Goal:** Prove CPA. Increase budget. Add Bing.

### Month 3 Actions
- [ ] If tCPA campaigns stable within ±20% of target for 10+ days → switch Core Local to tCPA $75
- [ ] Increase Core Local daily budget from $47 → $65 (20% increase)
- [ ] Increase LSA max per-lead bid if volume is low and CPL is under target
- [ ] Launch Microsoft/Bing Search: import Google campaigns, adjust bids -15%
- [ ] Launch Meta certified-brand audience (Tesla + JLR/LR interest-based prospecting)
- [ ] Upgrade budget from $4,000 → $6,000/month if CPA is proven
- [ ] Add retargeting display layer on Google (if website pixel pool ≥500 users)
- [ ] Implement offline conversion import (if DMS data available)
- [ ] Monthly performance review: present CPL, booked RO rate, cost per booked RO to client

**Month 3 checkpoint:** Qualified leads/month ≥50, CPL ≤$85, Rank-Lost IS on core campaign <60%.

---

## Phase 5 — Grow (Months 4–6)

**Goal:** Multi-location expansion. Full-funnel Meta. Scale Toyota.

### Month 4–6 Actions
- [ ] Create location-specific ad groups or campaigns for each Wallace location
- [ ] Scale Toyota campaign from $400 → $600/month if CPL <$100
- [ ] Switch Toyota campaign from Maximize Clicks → Maximize Conversions (once 30 conversions)
- [ ] Expand Meta: add Toyota testimonial video as creative format
- [ ] Add YouTube: 30-second pre-roll targeting local Toyota/auto owners (if budget allows)
- [ ] Scale toward $8–10K/month if CPA remains under $90
- [ ] Quarterly performance review: MER calculation, ROAS vs. target

---

## Decision Log (Items Needing Client Input)

| # | Decision | Owner | Deadline |
|---|----------|-------|----------|
| 1 | Is Wallace Toyota Collision Care certified? | Client | Day 1 |
| 2 | Authority: PSG proposes only vs. executes directly? | Client | Day 1 |
| 3 | DMS for offline RO import (CCC ONE, Mitchell, Audatex)? | Client | Day 7 |
| 4 | Website CMS for GTM / pixel install? | Client | Day 3 |
| 5 | Multiple locations — which cities/addresses? | Client | Day 1 |
| 6 | Target cost per booked repair order? | Client | Day 7 |
| 7 | Call recording consent — does Wallace allow recording? | Client | Day 7 |
| 8 | Creative assets — who shoots before/after and testimonial video? | PSG/Client | Day 14 |
| 9 | Budget approval for CallRail ($60–100/month)? | Client | Day 3 |
| 10 | Ford brand campaign — separate now or defer? | Client | Day 7 |
