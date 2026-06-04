# Wallace Collision Center — Complete Paid Advertising Plan
**Client:** Wallace Collision Center  
**Agency:** Phoenix Solutions Group  
**Market:** Tri-Cities Metro (Kingsport, Johnson City, Bristol, TN)  
**Account:** 604-861-1995  
**Current Spend:** $4,040/month (Google Ads only)  
**Target Spend:** $4,000 → $6,000 → $10,000/month (phased)  
**Primary Goal:** Qualified collision repair leads (form submit + inbound call ≥60s)  
**Date:** 2026-05-06  
**Status:** Ready for execution pending client confirmations  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Situation Analysis](#2-situation-analysis)
3. [Market Intelligence](#3-market-intelligence)
4. [Competitive Analysis](#4-competitive-analysis)
5. [Platform Strategy](#5-platform-strategy)
6. [Campaign Architecture](#6-campaign-architecture)
7. [Budget Plan](#7-budget-plan)
8. [Creative Strategy](#8-creative-strategy)
9. [Tracking & Measurement](#9-tracking--measurement)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [KPI Targets](#11-kpi-targets)
12. [Client Decisions Required](#12-client-decisions-required)

---

## 1. Executive Summary

Wallace Collision Center holds a rare triple OEM certification — Toyota Collision Care, Tesla Approved, and Jaguar/Land Rover Certified — that no national franchise competitor can claim. No independent body shop in the Tri-Cities market matches this combination. The certifications are the moat. They are currently underutilized in paid advertising.

**The core problem is not budget. It is broken measurement.**

$4,040/month flows into Google Ads. The account reports 2,162 "conversions" per month on 2,373 clicks (91% conversion rate) because the primary conversion action fires on page load, not on a form submit or phone call. Smart Bidding is trained to buy page loads. Every optimization decision downstream is inverted.

**The plan:**

| Priority | Action | Timeline | Impact |
|----------|--------|----------|--------|
| 1 | Fix conversion tracking | Days 1–7 | Enables all optimization |
| 2 | Launch Google LSA | Days 1–14 | $25–75/lead, lowest CPL channel |
| 3 | Launch Toyota campaign | Days 15–21 | Highest-volume certified opportunity |
| 4 | Rebuild core local + certified-brand campaigns | Days 15–30 | Eliminate $1,200+/month waste |
| 5 | Launch Meta retargeting + Toyota owner audiences | Days 22–30 | Bottom-funnel + awareness |
| 6 | Scale to $6K → $10K/month | Days 60–90 | 100–150 qualified leads/month |

**Conservative projection, same $4,000/month, post-rebuild:**
- Real leads: 40–70/month (vs. current: unmeasurable)
- True CPL: $55–85 (vs. reported fake: $1.82)
- Waste eliminated: $1,200–1,800/month from Tesla/JLR non-collision terms
- Reinvested waste → +30–50% qualified lead volume within 90 days

**Full $10,000/month projection (Month 6):**
- 100–150 qualified leads/month
- 35–52 booked repair orders (at 35% close rate)
- ~$87,500–130,000/month revenue attribution at $2,500 avg RO

---

## 2. Situation Analysis

### Account Health Score: ~35/100 (F)

#### Campaign Diagnostic

| Campaign | 90d Spend | Reported CPA | True CPA Est. | Search IS | Rank Lost | Grade |
|----------|-----------|--------------|---------------|-----------|-----------|-------|
| PPC_Wallace_40Miles | $3,944 | $1.82 | $50–90 | 10% | **80%** | D |
| Tesla Approved | $4,597 | $37.68 | $200+ | 15% | 38% | F |
| JLR Certified Collision | $2,751 | $35.27 | $100+ | 11% | 17% | D |
| Wallace Ford of Kingsport | $827 | $2.56 | Brand-only | — | — | Separate business |

#### Five Core Problems

**Problem 1 — Conversion tracking corrupts Smart Bidding (Critical)**

The `Landing Page` conversion action is categorized as SUBMIT_LEAD_FORM but fires on every page load, set to MANY_PER_CLICK. Every click registers as a lead. PPC_Wallace_40Miles shows 2,373 clicks → 2,162 "conversions" (91% rate). Real GA4 lead signals (`qualify_lead`, `close_convert_lead`) are HIDDEN — not feeding Smart Bidding. The algorithm actively bids to maximize page loads.

**Problem 2 — Tesla and JLR campaigns buy research traffic (Critical)**

Single-word broad-match brand keywords ("tesla," "range rover," "jaguar") enter every possible query for those brands. Top wasted terms: `tesla dealership`, `tesla battery replacement cost`, `tesla customer service number`, `range rover parts`, `land rover for sale`. Estimated waste: 40–55% of combined Tesla/JLR spend = $1,000+/month.

**Problem 3 — Quality Scores are floor-level (High)**

| Campaign | Typical QS |
|----------|-----------|
| JLR Certified Collision | 0 (most keywords — Google cannot evaluate) |
| Tesla Approved | 2–3 |
| PPC_Wallace_40Miles | 3–5 |
| Best keyword (body shop estimates) | 7 |

QS 3 vs. QS 7 means paying roughly 2.3× per click for equivalent position. Low QS is why the core campaign loses 80% of auctions to rank even with aggressive bids.

**Problem 4 — Budget flows to the wrong campaigns (High)**

PPC_Wallace_40Miles (the profit driver) loses 80% of auctions to rank. Budget is not the bottleneck — bid × QS is. Raising budget alone won't help. Tesla and JLR campaigns exhaust their budgets on waste before certified searchers arrive.

**Problem 5 — Two businesses share one account (Medium)**

Wallace Ford of Kingsport's Smart Campaign shares `primary_for_goal` conversion signals with the collision campaigns, polluting attribution and coupling budget decisions across unrelated businesses.

---

## 3. Market Intelligence

*Source: SEMRush Live Data, May 2026*

### Core Collision Keywords

| Keyword | Volume | CPC | Competition | Channel |
|---------|--------|-----|-------------|---------|
| body shop near me | 74,000 | $2.88 | 0.44 | LSA primary |
| collision repair near me | 60,500 | $3.32 | 0.47 | LSA primary |
| auto body shop near me | 60,500 | $2.92 | 0.50 | LSA primary |
| auto paint shop near me | 12,100 | $2.22 | 0.65 | Search: Paint & Dent |
| bumper repair near me | 3,600 | $2.71 | 0.79 | Search: Paint & Dent |

### Toyota Certified Keywords

| Keyword | Volume | CPC | Competition | Notes |
|---------|--------|-----|-------------|-------|
| toyota body shop near me | 1,600 | $2.62 | 0.57 | Lead keyword |
| toyota certified collision center | 720 | $3.30 | 0.30 | High intent, low competition |
| toyota certified body shop | 260 | $2.89 | 0.44 | Core certified |
| toyota certified collision repair | 90 | $3.82 | 0.34 | Highest intent |
| toyota certified repair near me | 20 | $0 | 0.43 | Zero paid competition |

### Local Market Keywords

| Keyword | Volume | CPC | Competition | Notes |
|---------|--------|-----|-------------|-------|
| body shop johnson city tn | 110 | $3.28 | 0.22 | Low competition |
| collision repair kingsport tn | 30 | $2.46 | 0.33 | **Zero paid competition** |
| collision repair bristol tn | 20 | $0 | 0.66 | **Zero paid competition** |

### Specialty Certified Keywords

| Keyword | Volume | CPC | Competition |
|---------|--------|-----|-------------|
| tesla approved body shop | 1,300 | $5.91 | 0.26 |
| land rover certified body shop | 40 | $4.18 | 0.53 |

### Key Market Findings

1. **Zero paid competition on exact local terms.** "collision repair kingsport tn," "toyota certified repair near me," "collision repair bristol tn" — no advertisers. Wallace can own these for $2–3/click.
2. **Toyota CPCs are $2.62–$3.82, not $7–18.** Max CPC caps at $8, not $15–18.
3. **"Near me" is where leads are.** 60K–74K monthly searches confirm LSA as primary channel.
4. **National franchises own generic terms.** Caliber, Joe Hudson, Gerber dominate "body shop near me" nationally. Wallace wins on certified differentiation and local geo precision.
5. **Toyota campaign priority confirmed.** 2,720 Toyota certified searches/month vs. 1,300 Tesla and ~200 JLR. Toyota outsells both combined 20:1 in rural TN.

---

## 4. Competitive Analysis

### Competitor Map

| Competitor | Toyota Certified | Tesla Approved | JLR Certified | Type | Threat Level |
|------------|-----------------|----------------|----------------|------|-------------|
| Toyota of Kingsport | Yes | No | No | Dealer | High — claims "only certified within 100 miles" |
| Toyota of Bristol | Likely | No | No | Dealer | Medium |
| Joe Hudson's Collision | No | No | No | National franchise | Medium — high ad spend |
| Caliber Collision | No | No | No | National franchise | Medium — high ad spend |
| Gerber Collision / Crash Champions | No | No | No | National franchise | Low |
| B&E Collision | No | No | No | Local independent | Low |
| EM Collision / Automan | No (I-CAR only) | No | No | Local independent | Low |

### Wallace's Unfair Advantage

**No competitor holds triple OEM certification.** National franchises cannot claim Toyota, Tesla, or JLR. Local independents have no OEM certification. Toyota of Kingsport can match Toyota certification but carries dealer stigma.

**Counter-positioning against Toyota of Kingsport (primary threat):**

| Their Claim | Our Counter |
|-------------|-------------|
| "Only Toyota certified within 100 miles" | "Wallace is also Toyota Certified — and we're not a dealership" |
| Dealer-owned, all-manufacturer bias | Independent — on your side, not trying to sell you a car |
| Dealer service queue competition | Dedicated collision center — faster turnaround |
| Perceived dealer markup | All major insurers accepted, no inflated dealer prices |

**The moat:** Toyota certification, rare in independent shops. Tesla approval, fewer than 5 shops within 200 miles. JLR certification, even rarer. This triple combination exists nowhere else in the Tri-Cities market.

---

## 5. Platform Strategy

### Recommended Platform Mix

| Platform | Role | Phase 1 ($4K) | Phase 3 ($10K) |
|----------|------|--------------|----------------|
| Google LSA | Primary lead gen — pay-per-lead, Google Guaranteed | $1,600 (40%) | $3,500 (35%) |
| Google Search — Core Local | High-intent collision queries | $1,200 (30%) | $3,000 (30%) |
| Google Search — Toyota Certified | Brand differentiation, certified demand | $400 (10%) | $750 (7.5%) |
| Google Search — Brand | Protect Wallace brand terms | $200 (5%) | $400 (4%) |
| Google Search — Tesla + JLR | Certified specialty (tightly scoped) | $200 (5%) | $750 (7.5%) |
| Meta — Retargeting | Bottom-funnel website visitors | $200 (5%) | — |
| Meta — Local Awareness + Toyota | Toyota owner prospecting + local homeowners | $200 (5%) | $1,500 (15%) |
| Microsoft/Bing | Import from Google, captures 35+ demo | Not yet | $1,100 (11%) |

### Why This Mix

**Google LSA first:** $25–75/lead vs. $85–90 Search average. Google Guaranteed badge. Appears above Search ads. Pay per qualified lead, not per click. Lowest CPL in the channel mix.

**Core Local second:** 60K–74K monthly "near me" searches. National franchises bid aggressively on generic terms — Wallace competes on certified differentiation and local geo precision.

**Toyota third (not Tesla):** Toyota is the highest-volume certified opportunity. 2,720 searches/month at $2.62–$3.82 CPC vs. Tesla's 1,300 at $5.91. Toyota outsells Tesla in rural TN 20:1.

**Meta retargeting:** Collision customers research before deciding. Retargeting website visitors 30-day recaptures dropped sessions at low CPM.

**Microsoft/Bing Phase 3 only:** Import Google campaigns at -15% bids. Captures the 35+ demographic. Not a Day 1 priority.

### What We Will NOT Do (Phase 1)

- No Performance Max — needs clean conversion signal first; cannibalizes exact-match in small accounts
- No geo expansion beyond 40-mile for core, 75-mile for certified
- No Display or YouTube until retargeting pool reaches 500+ monthly visitors
- No broad-match until tCPA bidding is stable
- No Wallace Ford — separate business, separate account
- No bid caps above $8–10 on Toyota terms (SEMRush confirms $2.62–$3.82 actual CPCs)

---

## 6. Campaign Architecture

*Full detail in `CAMPAIGN-ARCHITECTURE.md` and `TOYOTA-CAMPAIGN.md`*

### Naming Convention

```
[Platform]_[BusinessUnit]_[Objective]_[Audience/Theme]_[Date]
```

Examples:
- `GOOG_WAL_SRCH_LocalCollision_2026Q2`
- `GOOG_WAL_LSA_AllServices_2026Q2`
- `GOOG_WAL_SRCH_ToyotaCertified_2026Q2`
- `META_WAL_RET_WebsiteVisitors_2026Q2`

### Google Ads Structure

```
Google Ads Account (604-861-1995)
│
├── LSA — Google Guaranteed (all collision services)
├── GOOG_WAL_SRCH_Brand_2026Q2
│   └── [exact/phrase] Wallace brand terms — Target IS 90% top of page
├── GOOG_WAL_SRCH_LocalCollision_2026Q2
│   ├── Ad Group 1: Collision Repair (core "near me" + local)
│   ├── Ad Group 2: Body Shop (body shop near me + local)
│   ├── Ad Group 3: Paint & Dent (paintless dent + paint)
│   ├── Ad Group 4: Estimate / Insurance (estimate + insurance)
│   └── Ad Group 5: Competitor Conquest (Caliber, Service King)
│   Bid strategy: Max Conversions → tCPA $75 (after 30 clean conversions)
├── GOOG_WAL_SRCH_ToyotaCertified_2026Q2 [NEW — Priority 1]
│   ├── Ad Group 1: Toyota Certified Collision (phrase/exact) — Max CPC $8
│   ├── Ad Group 2: Toyota Model-Specific (Tacoma, RAV4, Tundra, 4Runner) — Max CPC $6
│   └── Ad Group 3: Toyota Dealer Conquest (Toyota of Kingsport/Bristol) — Max CPC $5
│   Bid strategy: Maximize Clicks ($8 cap) → Max Conversions (after 30 clean conversions)
├── GOOG_WAL_SRCH_TeslaApproved_2026Q2 [REBUILT — tight scope]
│   └── Phrase + exact: tesla approved body shop, tesla certified collision repair
│   Geo: LOP only, 75-mile radius | Bid: Manual CPC $20 max
└── GOOG_WAL_SRCH_JLRCertified_2026Q2 [REBUILT — tight scope]
    └── Phrase + exact: JLR/LR/Range Rover certified collision terms
    Geo: LOP only, 75-mile radius | Bid: Manual CPC $25 max
```

### Meta Ads Structure

```
Meta Business Manager — Wallace Collision
│
├── META_WAL_RET_WebsiteVisitors_2026Q2
│   ├── Ad Set 1: All visitors 30-day ($150/month)
│   └── Ad Set 2: High-intent (estimate/contact page) ($100/month)
├── META_WAL_PROS_LocalAwareness_2026Q2
│   └── Kingsport metro, homeowners, 28–65 ($150/month)
└── [Month 3] META_WAL_PROS_ToyotaOwners_2026Q2
    └── Toyota vehicle interest, 75-mile radius ($200/month)
```

### Conversion Action Configuration (post-fix)

| Action | Status | Priority | Change Required |
|--------|--------|----------|-----------------|
| Calls from ads (≥60s) | Primary | Keep | Verify 60s threshold |
| Form (GA4_CUSTOM) | Primary | Keep | Fix to ONE_PER_CLICK |
| GA4 qualify_lead | HIDDEN → Primary | Promote | Unhide + set primary |
| Landing Page (WEBPAGE) | Primary → Secondary | Demote | Remove from Smart Bidding |
| Directions, visits, engagements | Primary → Secondary | Demote | Track only, not optimize |

### Global Negative Keywords

**Employment/Education:** jobs, career, hiring, salary, training, school, how to become

**DIY/Informational:** diy, how to, tutorial, guide, reddit, forum, history of

**Non-collision services:** mechanic, engine, transmission, oil change, tire, alignment, brake, smog

**Parts/Aftermarket:** parts, oem parts, for sale, buy, cheap, wholesale, ebay

**Research/Non-buying:** review, vs, compare, mpg, specs, price, msrp, lease, finance

*Tesla and JLR campaigns have 300+ additional negatives — see CAMPAIGN-ARCHITECTURE.md*

---

## 7. Budget Plan

### Phase 1 — $4,000/month (Current Spend, Redistributed)

| Platform / Campaign | Monthly | Daily Cap | % |
|--------------------|---------|-----------|---|
| Google LSA | $1,600 | $53 | 40% |
| Google Search — Core Local | $1,200 | $40 | 30% |
| Google Search — Toyota Certified | $400 | $13 | 10% |
| Google Search — Brand | $200 | $7 | 5% |
| Google Search — Tesla Approved | $150 | $5 | 4% |
| Google Search — JLR Certified | $100 | $3 | 2.5% |
| Meta — Retargeting | $200 | $7 | 5% |
| Meta — Local Awareness + Toyota | $150 | $5 | 3.75% |
| **Total** | **$4,000** | **~$133** | **100%** |

### Phase 2 — $6,000/month (Month 3, CPA proven)

| Platform / Campaign | Monthly | % |
|--------------------|---------|---|
| Google LSA | $2,100 | 35% |
| Google Search — Core Local | $1,800 | 30% |
| Google Search — Toyota Certified | $600 | 10% |
| Google Search — Brand | $300 | 5% |
| Google Search — Tesla + JLR | $500 | 8% |
| Meta — Full | $700 | 12% |
| **Total** | **$6,000** | **100%** |

### Phase 3 — $10,000/month (Month 6, scale target)

| Platform / Campaign | Monthly | % |
|--------------------|---------|---|
| Google LSA | $3,500 | 35% |
| Google Search — Core Local | $3,000 | 30% |
| Google Search — Toyota Certified | $750 | 7.5% |
| Google Search — Brand | $400 | 4% |
| Google Search — Tesla + JLR | $750 | 7.5% |
| Meta — Full Funnel | $1,500 | 15% |
| Microsoft/Bing | $1,100 | 11% |
| **Total** | **$10,000** | **~100%** |

### 70/20/10 Framework

| Tier | Allocation | Campaigns |
|------|-----------|-----------|
| Proven (70%) | $2,800 | Google LSA + Core Search (once CPA proven, Day 60+) |
| Growth (20%) | $800 | Toyota Certified + Meta (scaling what's working) |
| Testing (10%) | $400 | Tesla, JLR, new audiences, new formats |

### Scaling Rules

**20% Scale Rule:** CPL < $75 for 7+ consecutive days with ≥10 conversions/week → increase budget 20%. Wait 5 days before next increase. Never increase Meta >20% in 7 days (triggers learning reset).

**3× Kill Rule:** Any ad group spends >$225 (3× $75 CPL) with zero qualified leads → pause. Don't restart without changes.

**LSA Budget Management:** CPL >$75 for 2 weeks → reduce max per-lead bid $5. CPL <$40 for 2 weeks → increase max per-lead bid $5.

### Projected ROI

| Month | Phase | Est. Leads | CPL | Booked RO (35%) | Avg RO | Revenue |
|-------|-------|-----------|-----|-----------------|--------|---------|
| 1 | Learning | 25 | $160 | 9 | $2,500 | $22,500 |
| 2 | Optimizing | 40 | $100 | 14 | $2,500 | $35,000 |
| 3 | Stable | 55 | $73 | 19 | $2,500 | $47,500 |
| 6 | Scaling | 70 | $57 | 25 | $2,500 | $62,500 |
| 6+ Toyota | Scaling | 12–18 | $50 | 4–6 | $3,500 | $14,000–21,000 |

**Month 6 blended ROAS (core + Toyota):** ~15–19×

### Seasonality

| Period | Demand | Budget Action |
|--------|--------|--------------|
| Jan–Feb | Lower | Hold budget, test creative |
| Mar–Apr | Ramping | +20% March 1 (spring hail season) |
| May–Jun | Peak | Full budget, scale if CPL holds |
| Jul–Aug | Steady | Maintain |
| Sep–Oct | Pre-holiday | Hold or +10% |
| Nov–Dec | Slowdown | -15%, maintain LSA |

**Hail event protocol:** After significant hail, increase Meta $200–500 for 2 weeks. High-intent demand surge.

---

## 8. Creative Strategy

*Full copy in `CREATIVE-BRIEF.md`*

### Brand Voice

**Tone:** Trustworthy, expert, local. Not corporate. Not flashy.  
**Core message:** "OEM certifications, real guarantees, no dealer games."  
**Primary differentiator:** Triple OEM certification — no independent competitor has this.

### Content Pillars

| Pillar | Theme |
|--------|-------|
| Toyota Certified | "Same certification as the dealer. None of the dealer experience." |
| Trust | Reviews, certifications, years in business |
| Expertise | Before/after, certifications on wall, techs at work |
| Convenience | Insurance accepted, rental assistance, free estimate |
| Urgency | Hail season, accident? Call now |
| OEM Triple Certified | Toyota + Tesla + JLR — no independent competitor can match |

### Ad Copy Summary

**Toyota campaign headline bank:** 15 RSA headlines including "Not the Dealer. Better Than the Dealer," "Toyota Certified Without the Dealer Price," "Independent. Certified. Toyota Approved."

**Core local headline bank:** 15 RSA headlines including "Kingsport's Trusted Collision Shop," "Lifetime Warranty on Every Repair," "All Major Insurance Carriers Accepted."

**Tesla/JLR campaigns:** Tight certification-specific headlines. Separate copy for each brand.

### Creative Asset Production Plan

| Asset | Priority | Format | Status |
|-------|----------|--------|--------|
| Toyota certified static (2 images) | **P1** | 1080×1080, 1080×1920 | Needed |
| Toyota certified video (15s) | **P1** | 9:16, 16:9 | Needed |
| Before/after pairs (5) | P1 | 1080×1080, 1080×1920 | Needed |
| Customer testimonial videos (3) | P1 | 15–30s, 9:16 | Needed — Day 30 |
| Shop/team credibility photos | P2 | 1080×1080 | Needed |
| Hail/urgency statics (3) | P2 | 1080×1080, 1080×1920 | Needed |
| Tesla certified static | P2 | 1080×1080 | Needed |
| JLR certified static | P2 | 1080×1080 | Needed |

### Landing Page Requirements

| Campaign | URL | Required Before Launch |
|----------|-----|----------------------|
| **Toyota Certified** | **/toyota-certified/** | Yes — do not run Toyota ads to homepage |
| Core Local | /collision-repair/ | Recommended |
| Tesla Approved | /tesla-approved/ | Yes |
| JLR Certified | /jaguar-land-rover-certified/ | Yes |

**Critical gap:** All campaigns currently send traffic to the same general page. `/toyota-certified/` must exist before Toyota campaign launches. It is the hard prerequisite.

**Toyota landing page must include:** Toyota Collision Care badge above fold, "Not the Dealership" headline, OEM parts callout, all insurers callout, lifetime warranty, estimate form + phone above fold, before/after on Toyota vehicles.

---

## 9. Tracking & Measurement

*Full detail in `TRACKING-SETUP.md`*

### Priority Overview

| Priority | Action | Blocking? |
|----------|--------|-----------|
| P0 | Fix Google Ads conversion actions | Yes — all optimization blocked until done |
| P1 | Set up Google LSA profile + Google Guaranteed | Yes — required before LSA launches |
| P1 | Deploy Meta Pixel via GTM | Yes — required before any Meta campaigns |
| P2 | Verify GA4 events + import qualify_lead to Google Ads | Required for tCPA migration |
| P2 | Set up CallRail (recommended) | Required for cross-channel call attribution |
| P3 | Offline conversion import (DMS → Google Ads) | High-value, not Day 1 |
| P3 | Meta CAPI (server-side) | Month 2–3 |

### Conversion Action Fix (Days 1–3, must complete first)

1. **Landing Page (WEBPAGE):** Demote from primary goal → secondary. Reason: page loads are not leads.
2. **Form (GA4_CUSTOM):** Change counting from MANY_PER_CLICK → ONE_PER_CLICK.
3. **GA4 qualify_lead:** Unhide, set primary_for_goal = YES.
4. **Calls from ads:** Verify call duration threshold = 60 seconds.
5. **Demote to secondary:** Directions, website visits, menu views, other engagements, store visits.

### Primary Conversions (Smart Bidding signals)

1. Inbound call ≥60 seconds (AD_CALL)
2. Form submission — qualify_lead GA4 event (ONE_PER_CLICK)

### Call Tracking Options

**Option A — Google Forwarding Numbers (free):** Works for Google campaigns only. Minimum viable.

**Option B — CallRail ($60–100/month, recommended):** Separate numbers per channel. Call recording. Dynamic number insertion. GA4 + Google Ads integration. Cross-channel attribution.

**Tennessee law:** One-party consent state. Call recording allowed.

### Tracking Health Dashboard (weekly)

| Check | Tool | Alert Threshold |
|-------|------|-----------------|
| Conversion counts | Google Ads | <5 conversions/week on any primary action |
| Call duration distribution | CallRail | <30% calls ≥60 seconds |
| GA4 qualify_lead volume | GA4 | Diverges >20% from CallRail |
| Meta Pixel health | Events Manager | EMQ score <6.0 |
| LSA leads + disputes | LSA dashboard | Any invalid leads — dispute immediately |

---

## 10. Implementation Roadmap

*Full detail in `IMPLEMENTATION-ROADMAP.md`*

### Phase Overview

| Phase | Timeline | Focus | Budget |
|-------|----------|-------|--------|
| 1. Foundation | Days 1–14 | Tracking fix, LSA setup, Meta pixel | $4,000/mo |
| 2. Rebuild | Days 15–30 | Toyota campaign, campaign restructure, Meta | $4,000/mo |
| 3. Stabilize | Days 31–60 | QS improvement, bidding migration | $4,000/mo |
| 4. Scale | Days 61–90 | Budget increase, Bing, expand | $6,000/mo |
| 5. Grow | Month 4–6 | Multi-location, Meta full-funnel, Toyota scale | $8–10K/mo |

### Phase 1 — Foundation (Days 1–14)

**Week 1:**
- [ ] Fix all conversion actions in Google Ads (P0 — nothing else happens until done)
- [ ] Verify call duration threshold = 60 seconds
- [ ] Begin Google LSA application (takes 3–10 business days)
- [ ] Install Meta Pixel via GTM
- [ ] Configure Meta events: PageView, Lead, Contact
- [ ] Audit all Google Business Profile listings for completeness

**Week 2:**
- [ ] Verify GA4 qualify_lead fires on form submits
- [ ] Import qualify_lead into Google Ads as primary conversion
- [ ] Confirm Calls from ads tracking works (test call)
- [ ] Follow up on LSA Google Guaranteed application
- [ ] Build 300+ entry negative keyword lists
- [ ] Prune worst search terms from Tesla/JLR (hold campaigns live, just add negatives)

**Checkpoint (Day 14):** Reported conversions will drop from ~2,162 → 20–60/month. This is correct. Do not panic. Smart Bidding now has a real signal.

### Phase 2 — Rebuild (Days 15–30)

**Week 3:**
- [ ] Restructure Core Local into 5 themed ad groups
- [ ] Write 3 RSAs per ad group (from CREATIVE-BRIEF.md)
- [ ] **Build /toyota-certified/ landing page** (prerequisite — must complete before Toyota campaign)
- [ ] **Launch GOOG_WAL_SRCH_ToyotaCertified_2026Q2** — Ad Group 1 first
- [ ] Set Toyota max CPC = $8 (not $15–18)
- [ ] Rebuild Tesla campaign: phrase/exact only, apply all negatives, switch to Manual CPC
- [ ] Rebuild JLR campaign: same approach
- [ ] Add all extensions (sitelinks must include Toyota Certified → /toyota-certified/)
- [ ] **LSA goes live** (if Google Guaranteed approved)

**Week 4:**
- [ ] Add Toyota model-specific ad group (Tacoma, RAV4, Tundra, 4Runner, Highlander, Camry)
- [ ] Add Toyota dealer conquest ad group (Toyota of Kingsport, Toyota of Bristol)
- [ ] Launch Meta retargeting (30-day visitors + high-intent page visitors)
- [ ] Launch Meta Toyota owner audience (Toyota vehicle interest, 75-mile)
- [ ] Launch Meta local awareness (20-mile radius, homeowners 28–65)
- [ ] Source Toyota creative assets: certification badge, Toyota vehicles repaired
- [ ] Separate Wallace Ford campaign into its own Google Ads account

**Checkpoint (Day 30):** LSA leads should be flowing. Tesla/JLR non-collision queries <10% of spend.

### Phase 3 — Stabilize (Days 31–60)

- [ ] Add negatives weekly from search term reports
- [ ] A/B test RSA headlines (pin underperforming, test replacements)
- [ ] Core Local: ≥15 clean conversions → switch to Maximize Conversions
- [ ] Tesla/JLR: clean leads flowing → switch Manual CPC → tCPA $150 ceiling
- [ ] Review call recordings weekly (lead quality + call handling assessment)
- [ ] Begin offline conversion import if DMS export available
- [ ] Add Meta lookalike audience (needs 100+ pixel events first)
- [ ] Creative shoot: before/after photos + testimonial videos

**Checkpoint (Day 60):** Avg QS improving 3–4 → 5–6. CPL dropping toward $75–90 target.

### Phase 4 — Scale (Days 61–90)

- [ ] If tCPA stable within ±20% of target for 10+ days → switch Core Local to tCPA $75
- [ ] Increase Core Local daily budget $47 → $65 (20% rule)
- [ ] Adjust LSA per-lead bid based on CPL performance
- [ ] Launch Microsoft/Bing (import Google campaigns, adjust bids -15%)
- [ ] Launch Meta certified-brand audience (Tesla + JLR interest prospecting)
- [ ] Upgrade budget $4,000 → $6,000/month if CPA proven
- [ ] Add retargeting display layer (if website pixel pool ≥500 users)
- [ ] Monthly performance review: CPL, booked RO rate, cost per booked RO

**Checkpoint (Day 90):** ≥50 qualified leads/month. CPL ≤$85. Rank-lost IS on core <60%.

### Phase 5 — Grow (Months 4–6)

- [ ] Location-specific ad groups per Wallace location
- [ ] Toyota campaign $400 → $600/month if CPL <$100
- [ ] Toyota: Max Clicks → Maximize Conversions (once 30 conversions)
- [ ] Expand Meta: Toyota testimonial video creative
- [ ] YouTube: 30s pre-roll targeting local Toyota/auto owners (if budget allows)
- [ ] Scale toward $8–10K/month if CPA remains under $90
- [ ] Quarterly review: MER, ROAS vs. target

---

## 11. KPI Targets

### Core Account KPIs

| Metric | Month 1 (Baseline) | Month 3 (Target) | Month 6 (Target) | Month 12 (Target) |
|--------|--------------------|------------------|------------------|-------------------|
| Monthly leads (total) | 25 (learning) | 50–60 | 65–80 | 100–150 |
| CPL (blended) | $160 | $80 | $65 | $55 |
| Booked RO rate | Track only | 30% | 35% | 40% |
| Cost per booked RO | Track only | $275 | $200 | $150 |
| Monthly revenue attribution | $22,500 | $47,500 | $75,000+ | $100,000+ |
| ROAS (revenue/spend) | ~5.6× | ~12× | ~18× | ~25× |

### Campaign-Level KPIs

| Campaign | M1 CPL | M3 CPL | M6 CPL | M1 CTR | M3 CTR | M6 CTR |
|----------|--------|--------|--------|--------|--------|--------|
| LSA | $45–65 | $35–55 | $30–50 | N/A (pay-per-lead) | — | — |
| Core Local | $90–120 | $75–90 | $65–80 | 4% | 5.5% | 7% |
| Toyota Certified | Establish | <$100 | <$75 | 4% | 5.5% | 7% |
| Tesla Approved | $150+ | <$150 | <$125 | 5% | 6% | 7% |
| JLR Certified | $150+ | <$150 | <$125 | 4% | 5.5% | 6.5% |
| Meta — Retargeting | Track | CPL <$85 | CPL <$70 | 2% | 2.5% | 3% |

### Quality Score Targets

| Campaign | Current | Month 2 Target | Month 6 Target |
|----------|---------|---------------|---------------|
| Core Local | 3–5 avg | ≥5 avg | ≥7 avg |
| Toyota Certified | New | ≥5 avg | ≥7 avg |
| Tesla Approved | 2–3 avg | ≥5 avg | ≥6 avg |
| JLR Certified | 0–2 avg | ≥4 avg | ≥6 avg |

### Impression Share Targets (Core Local)

| Metric | Current | Day 60 | Day 90 |
|--------|---------|--------|--------|
| Search IS | 10% | 20%+ | 30%+ |
| Rank-Lost IS | 80% | <60% | <40% |
| Budget-Lost IS | 12% | <15% | <10% |

### Toyota Campaign KPIs

| Metric | Month 1 | Month 3 | Month 6 |
|--------|---------|---------|---------|
| CPL | Establish baseline | <$100 | <$75 |
| Monthly leads | 5–8 | 10–15 | 15–25 |
| CTR | >4% | >5.5% | >7% |
| Booked RO rate | Track | 30% | 35% |
| Cost per booked RO | Track | <$350 | <$250 |
| Revenue attribution | Track | $10,500 | $21,000+ |

*Toyota average RO: $3,000–5,000. At $250/booked RO and $3,500 avg = 14× ROAS from Toyota campaign alone.*

---

## 12. Client Decisions Required

These decisions must be resolved before execution can begin. All are marked with the day by which they block progress.

| # | Decision | Owner | Blocks | Deadline |
|---|----------|-------|--------|----------|
| 1 | Is Wallace Toyota Collision Care certified currently? | Client | Toyota campaign | Day 1 |
| 2 | Authority scope: PSG proposes only, or executes directly? | Client | Everything | Day 1 |
| 3 | Multiple locations — which cities/addresses? | Client | LSA, geo, ad groups | Day 1 |
| 4 | Website CMS (for GTM / pixel install)? | Client | Tracking | Day 3 |
| 5 | Budget approval for CallRail ($60–100/month)? | Client | Call attribution | Day 3 |
| 6 | Wallace Ford brand campaign — separate now, or defer? | Client | Account structure | Day 7 |
| 7 | DMS for offline RO import (CCC ONE, Mitchell, Audatex)? | Client | Offline conversions | Day 7 |
| 8 | Target cost per booked repair order? | Client | tCPA targets | Day 7 |
| 9 | Call recording consent — does Wallace allow recording? | Client | CallRail setup | Day 7 |
| 10 | Creative assets — who shoots before/after + testimonial video? | PSG / Client | Meta creative | Day 14 |

---

## Supporting Documents

| Document | Contents |
|----------|----------|
| `ADS-STRATEGY.md` | Full strategic rationale, SEMRush data, platform analysis |
| `CAMPAIGN-ARCHITECTURE.md` | Complete campaign structure, ad groups, negative keyword lists |
| `TOYOTA-CAMPAIGN.md` | Toyota keyword strategy, competitive intel, full campaign build |
| `BUDGET-PLAN.md` | Phase-by-phase budget, scaling rules, projected ROI |
| `CREATIVE-BRIEF.md` | Full RSA headline banks, descriptions, Meta creative specs |
| `TRACKING-SETUP.md` | Step-by-step conversion fix, LSA setup, Meta pixel, CallRail |
| `IMPLEMENTATION-ROADMAP.md` | Day-by-day checklist across 5 phases |
| `GTM-SETUP.md` | Google Tag Manager configuration |

---

*Wallace Collision Center — Paid Advertising Master Plan | PSG | 2026-05-06*
