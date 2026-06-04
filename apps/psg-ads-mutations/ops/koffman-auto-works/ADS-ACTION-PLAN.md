# Koffman AutoWorks — Ads Action Plan

Prioritized recommendations from `/ads audit`. Critical → High → Medium → Low.

---

## CRITICAL (Fix Immediately — Revenue/Data Loss Risk)

| # | Action | Owner | Effort | Why |
|---|---|---|---|---|
| C1 | Install GA4 via GTM on Koffman site | PSG / Web vendor | 2 hrs | Site has zero measurement. Every $ today = directional guess. |
| C2 | Install Google Ads conversion tag + Enhanced Conversions | PSG | 2 hrs | Hibu cannot optimize what it cannot measure. |
| C3 | Install Meta Pixel + Conversions API (CAPI) | PSG | 3 hrs | Turnkey cannot run structured Meta campaigns without pixel. |
| C4 | Install CallRail with dynamic number swap | PSG | 2 hrs | Currently 3 phone numbers in circulation. Attribution broken. |
| C5 | Request Hibu Google Ads + iPromote read-only access | Heather → Hibu | 10 min | Cannot audit account contents without it. Refusal = pitch ammunition. |
| C6 | Request Turnkey Meta Business Manager + Ad Account access | Heather → Turnkey | 10 min | Same as above. |
| C7 | Pull Hibu + Turnkey + Shopgenie + AutoFix invoices from QuickBooks (AR / CR labels) | Heather → PSG | 15 min | Confirms $7-9k/mo estimate. Drives Year-1 break-even math. |
| C8 | Resolve phone-number conflict — pick one primary, point all listings + tracking to it | Heather + PSG | 1 hr | (920) 533-5930 vs (920) 533-2031 vs (610) 888-5554 chaos. |
| C9 | Confirm orphan site `danv211.sg-host.com` ownership; 301 or take down | Heather / Hibu | 30 min | Brand SERP leak. SiteGround dev/staging URL leaking onto Koffman queries. |

---

## HIGH (Fix Within 7 Days — Significant Performance Drag)

| # | Action | Owner | Effort | Why |
|---|---|---|---|---|
| H1 | Demand itemized service-line breakdown from Hibu (in writing) | Heather | 30 min | BBB complaints document Hibu refusal. Refusal is the pitch. |
| H2 | Add "Auto Body Shop" as secondary GBP category + CR-specific services | PSG | 30 min | Currently only "Auto Repair Shop." Map Pack invisible for CR. |
| H3 | Activate GBP Posts (weekly cadence — specials, before/after, community) | PSG | ongoing | Zero Posts in last 90 days per SERP signals. Free reach. |
| H4 | Build Carwise → Google review funnel (Heather requests Google review after Carwise) | Heather + PSG | 1 hr setup | 221 Carwise reviews, only 41 Google. Closes social-proof gap vs Jay's (95), Caliber (70), Auto Craft (62). |
| H5 | Add LocalBusiness + AutoRepair + AutoBodyShop schema (JSON-LD) | PSG | 2 hrs | Site has no structured data. Rich-result eligibility blocked. |
| H6 | Build geo landing pages — Fond du Lac, Kewaskum, Plymouth, West Bend, Eden | PSG | 1 wk | Koffman invisible in 4 surrounding metros. Caliber + Gerber + Dreher own FdL. |
| H7 | Migrate Meta strategy from "boosted posts" to structured Advantage+ Sales/Leads campaigns | Turnkey or PSG | 1 wk | Boosted posts ≠ campaigns. Inferior bidding, weak audiences. |
| H8 | Build CR-specific paid funnel (hail, deer, insurance-direct, ADAS) | PSG | 1-2 wks | CR dept fully under-served today. Heather doing it solo. |
| H9 | Audit Shopgenie ↔ Carwise/CCC duplication; route CR-only comms to Carwise, AR-only to Shopgenie | PSG + Turnkey + Heather | 4 hrs | Same customer hit by two systems with different branding. |
| H10 | Document who owns: domain, website, GA4, Search Console, GBP, Google Ads, Meta BM, Ad Account, all creative | PSG | 2 hrs | Critical pre-vendor-swap inventory. Hibu retains assets by default. |

---

## MEDIUM (Fix Within 30 Days — Optimization Opportunity)

| # | Action | Owner | Effort | Why |
|---|---|---|---|---|
| M1 | Rebuild site off Hibu (Webflow / WordPress / Next.js) | PSG | 4-6 wks | Asset ownership + speed + schema + landing pages all blocked by Hibu platform. |
| M2 | Pursue I-CAR Gold Class certification | Larry / Heather | 6-12 mo | Closes credential gap vs Auto Craft Kewaskum. Marketable claim. |
| M3 | Pursue one OEM cert (Subaru, Honda ProFirst, or Nissan) | Larry / Heather | 6-12 mo | Differentiates from every independent within 25 mi except Auto Craft. |
| M4 | Launch Microsoft / Bing Ads (1-click import from rebuilt Google Ads) | PSG | 4 hrs | 30-50% lower CPC than Google. Bing demo overlaps insurance-claim demo. |
| M5 | Build hail / deer / ADAS / paintless-dent state-level content (own "deer collision Wisconsin", "hail damage Wisconsin") | PSG | 4-6 wks | Russ Darrow owns these queries today. Room to take share. |
| M6 | Implement Tekmetric Marketing directly (cut Turnkey markup on Shopgenie) | PSG | 1 wk | Save markup. Same lifecycle automation, lower cost. |
| M7 | Bolt-on BodyShop Booster for CR photo estimates + AI virtual assistant | PSG | 2 wks | Closes CR pipeline gap. Specialist SaaS. |
| M8 | Build branded retention email — quarterly newsletter (winter/spring/summer/fall maintenance + CR seasonal) | PSG | ongoing | Email is owned channel; cheap revenue. |
| M9 | Direct mail seasonal — hail (June), deer (Oct-Nov), winter prep (Sept) | PSG | seasonal | Rural WI demo responds to mail. Caliber/Gerber don't do local mail. |
| M10 | YouTube pre-roll on Wisconsin DOT / weather / deer-collision content | PSG | 4 hrs setup | CR demand-creation; cheap impressions. |

---

## LOW (Backlog — Best Practice, Minor Impact)

| # | Action | Owner | Effort | Why |
|---|---|---|---|---|
| L1 | Refresh community-sponsorship leverage — turn Strike Out Hunger + 4th of July car show into earned-media + organic content | PSG + Heather | quarterly | Shelton Collision's giveaway PR play is a template Koffman can replicate. |
| L2 | Get Koffman listed in Campbellsport Chamber of Commerce (currently absent per SERP scan) | Heather | 30 min | Free citation + backlink. EB Auto Body is listed; Koffman is not. |
| L3 | Build internal review-velocity dashboard (Google + Carwise + Birdeye + BBB) | PSG | 4 hrs | Tracks the #1 KPI gap vs competitors. |
| L4 | Test TikTok organic for younger truck/ATV deer-collision demographic | PSG / Heather | weekly cadence | Phase 3 channel. Optional. |
| L5 | Add live chat (Drift / Intercom / native) for CR estimate-request friction | PSG | 1 wk | Form on `/contact` is the only intake; chat closes shorter sessions. |
| L6 | Set up Looker Studio dashboard tying GA4 + GBP + CallRail + Meta Ads + Google Ads into one weekly view | PSG | 1 wk | Replaces Hibu's opaque reporting. |
| L7 | Publish 1 Wisconsin auto-repair / collision-repair article per month for AI Overviews capture | PSG | monthly | LLMs cite content-rich domains. Russ Darrow currently dominates state-level. |
| L8 | Replace Hibu-printed merch line with PSG-designed | PSG | one-time | Brand consistency. |

---

## Sequencing — First 30 Days

### Week 1 (Discovery)
- C5, C6 — request access from Hibu + Turnkey
- C7 — pull invoices from Heather
- H1 — formal itemized-billing request to Hibu
- C9 — confirm orphan site ownership

### Week 2 (Stabilize)
- C1, C2, C3, C4 — install tracking stack
- C8 — resolve phone-number chaos
- H2, H3 — GBP fixes
- H5 — schema markup

### Week 3 (Pipeline)
- H4 — Carwise → Google review funnel live
- H7 — migrate Meta from boosts to campaigns (if Turnkey access granted)
- H8 — kick off CR-specific funnel
- H10 — asset-ownership inventory complete

### Week 4 (Decide)
- H9 — Shopgenie ↔ Carwise dedup decision
- Present PSG proposal to Heather with confirmed cost data
- Vote: replace Hibu, replace Turnkey, or both

---

## KPIs to Monitor (post-fix)

| Metric | Baseline (est.) | 90-Day Target | 12-Month Target |
|---|---|---|---|
| Google reviews | 41 | 75 | 150+ |
| Google review rating | 4.9 | 4.9 | 4.9+ |
| Organic monthly visits (SEMrush) | 62 | 250 | 800+ |
| Authority Score | 16 | 22 | 32+ |
| Conversion-tracked form/call leads | 0 (no tracking) | 50/mo | 150/mo |
| Cost per CR lead | unknown | $80-$150 | $50-$100 |
| CR pipeline value | unknown | $50k/mo | $100k/mo |
| Map Pack visibility (Campbellsport core 5 queries) | strong | strong | strong |
| Map Pack visibility (FdL metro) | 0 | partial | strong |

---

## Files

- See `ADS-AUDIT-REPORT.md` for findings detail
- See `ADS-QUICK-WINS.md` for sub-15-min fixes
- See `shop_marketing_pricing/results/*.json` for 14 vendor profiles
