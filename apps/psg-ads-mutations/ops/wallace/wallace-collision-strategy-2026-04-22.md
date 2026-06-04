# Wallace Collision Center — Google Ads Strategy

**Account:** 604-861-1995
**Location:** Kingsport, TN (America/Chicago)
**Spend:** ~$4,040/month
**Analysis Window:** 2026-01-22 → 2026-04-22 (90 days)
**Author:** Nick Schoolcraft (PSG) · via Google Ads MCP
**Status:** Strategy draft — no account changes made

---

## Executive Summary

Wallace Collision Center is spending roughly $4,000/month across four Google Ads campaigns, but the reported results are unreliable because conversion tracking is counting landing-page loads as "leads." Underneath the inflated conversion numbers, the account has three structural problems: (1) the Tesla and Jaguar/Land Rover certified-brand campaigns are burning 40–55% of their budget on research and navigation queries that have no collision-repair intent; (2) the profitable local collision campaign is losing 80% of its auctions to rank, meaning low Quality Scores and bids; (3) the campaign structure mixes a separate Ford dealership brand campaign into the collision account, contaminating optimization signals.

**Ads Health Score: ~35 / 100 (F)**

The recommended sequence is: fix measurement, eliminate waste, rebuild structure, migrate bidding, then expand. Same budget should produce 30–50% more qualified leads within 90 days.

---

## Diagnostic Scorecard

| Campaign | Type | 90d Spend | Reported CPA | True CPA Est. | Search IS | Budget Lost | Rank Lost | Grade |
|----------|------|-----------|--------------|---------------|-----------|-------------|-----------|-------|
| PPC_Wallace_40Miles | Search (Max Conv) | $3,944 | $1.82 | $50–90 | 10% | 12% | **80%** | **D** |
| Tesla Approved | Search (Max Conv) | $4,597 | $37.68 | $200+ | 15% | **47%** | 38% | **F** |
| JLR Certified Collision | Search (Max Conv) | $2,751 | $35.27 | $100+ | 11% | **71%** | 17% | **D** |
| Wallace Ford of Kingsport | Smart (Target Spend) | $827 | $2.56 | Brand-only | — | — | — | Separate business |

**Notes on the table**
- "Reported CPA" reflects Smart Bidding's current view, which is corrupted by the conversion tracking issue.
- "True CPA Est." is extrapolated from clean signals (call-through tagged conversions, wallace-branded query conversion rate, and category benchmarks for collision-repair search).
- "Search IS" = Search Impression Share. "Budget Lost" = share of auctions missed due to daily budget exhaustion. "Rank Lost" = share of auctions missed due to Ad Rank (bid × Quality Score).

---

## Core Problems

### 1. Conversion tracking is lying to Smart Bidding — Critical

The `Landing Page` conversion action is categorized as **SUBMIT_LEAD_FORM** but is wired as a **WEBPAGE** (page-view) tag set to **MANY_PER_CLICK** and flagged `primary_for_goal=TRUE`. It is being counted in the conversions metric. Every time a click loads the landing page, it registers as a lead.

**Evidence:**
- `PPC_Wallace_40Miles`: 2,373 clicks produced 2,162 "conversions" (91% rate). That is a page-load rate, not a lead rate.
- `Form` action is set to `MANY_PER_CLICK` (should be `ONE_PER_CLICK` for a lead form).
- 7 conversion actions are flagged `primary_for_goal=TRUE`, including page views, menu views, directions, and generic "engagements."
- Real GA4 lead imports (`qualify_lead`, `close_convert_lead`, `purchase`) exist but are **HIDDEN** — not feeding Smart Bidding.
- Legacy `CROToolkitLandingPage` and `CROToolkitPopup` are still present as `REMOVED` — historical noise.

**Why it matters:** Max Conversions bidding optimizes toward whatever you call a "conversion." Right now it is actively bidding up clicks that bounce and ignoring clicks that call or fill a form. Every other optimization on top of this has its direction reversed.

### 2. Tesla and JLR campaigns are paying for research traffic — Critical

The certified-brand campaigns are running broad-match on single-word brand terms, which lets Google auction them into every Tesla, Jaguar, Land Rover, and Range Rover query regardless of intent. Paid clicks are flowing to shopping, service, parts, and warranty searches.

**Top wasted search terms — Tesla Approved campaign (90 days):**

| Query | Cost | Conv | Intent |
|-------|------|------|--------|
| tesla (appeared 6+ times) | $200+ total | 3 | Navigation / research |
| tesla dealership | $28 | 0 | Purchase |
| tesla service / service center / support | $50+ | 0 | Warranty service |
| tesla windshield replacement | $22 | 2 | Glass — not collision |
| tesla model s / y / x / 3 | $50+ | 4 | Vehicle shopping |
| tesla battery replacement cost | $13 | 0 | Research |
| tesla customer service number | $40+ | 0 | Support |
| tesla parts | $10 | 0 | DIY |
| tesla knoxville / tesla price | $19 | 0 | Local dealer discovery |

**Same pattern in JLR Certified Collision campaign:**
"range rover parts," "land rover dealership near me," "jaguar cars," "jaguar f pace," "used land rover range rover for sale," "jaguar service near me."

**Estimated waste:** 40–55% of Tesla + JLR combined spend — roughly $3,000 over 90 days, or **$1,000+/month**.

### 3. Quality Score is floor-level — High

| Campaign | Most common QS |
|----------|----------------|
| JLR Certified Collision | **0** (unset — most keywords) |
| Tesla Approved | 2–3 |
| PPC_Wallace_40Miles | 3–5 |
| Best keyword in account | "body shop estimates" at QS **7** |

QS 0 on the JLR campaign means Google cannot even evaluate relevance. QS directly scales CPC: a keyword at QS 3 pays roughly 2.3× what the same keyword would pay at QS 7 for equivalent ad position. Low QS is why the core campaign is losing 80% of auctions to rank even when bids are aggressive.

Common causes in this account: broad keywords not reflected in ad headlines, landing pages not themed to the keyword group, and low historical CTR on broad-match expansions that drag down expected-CTR scoring.

### 4. Bidding strategy is starving the profitable campaign — High

- `PPC_Wallace_40Miles` (local collision — the profit driver): **80% rank-lost** but only 12% budget-lost. Budget is not the bottleneck. Bid × QS is. Raising the budget alone won't help.
- `Tesla Approved`: **47% budget-lost**. Spending its daily cap on waste queries before real certified-shop searchers arrive.
- `JLR Certified Collision`: **71% budget-lost**. Same pattern, worse.

**The money is flowing to the wrong campaigns.** Tight the certified campaigns, feed the saved dollars to the local campaign, raise QS so bids go further.

### 5. Campaign structure mixes two different businesses — Medium

`Wallace Ford of Kingsport Brand` is a Smart Campaign for a Ford dealership — a separate business from Wallace Collision Center. It shares the account's conversion goal primaries, which pollutes attribution reporting and couples budget decisions across unrelated businesses.

---

## Strategic Framework

### Objective hierarchy (to agree on before any account edits)

1. **Primary KPI:** Qualified collision claim leads (form submit + inbound call ≥60s) from the 40-mile service area around Kingsport.
2. **Secondary KPI:** Store visits and directions from certified-brand traffic (Tesla and JLR owners in-market for collision repair).
3. **Tertiary KPI:** Brand awareness to owners of Tesla/JLR who have not yet had a collision — captured into retargeting lists for later reactivation.

### Four strategic moves

#### Move 1 — Fix measurement before optimizing anything else

*Why:* Smart Bidding is only as intelligent as its signal. Today it is being trained to buy page loads.

*What:*
- Demote `Landing Page` (WEBPAGE action) from primary goal. Keep it tracked as Secondary so it is visible but not optimized toward.
- Promote `Form` to `ONE_PER_CLICK`. Keep primary.
- `Calls from ads` (AD_CALL type) is already primary — verify call length threshold is set to **≥60 seconds** before the call counts as a lead.
- Unhide GA4 `qualify_lead` and set primary. This becomes the bid-to-lead anchor once imported cleanly.
- Remove `Directions`, `Website visits`, `Menu views`, `Other engagements` from `primary_for_goal`. Keep all tracked but out of the Smart Bidding signal.
- If Wallace's DMS (CCC ONE, Mitchell, or similar) allows an RO export, add weekly offline conversion import. This ties ad spend directly to booked repair orders, not just leads.

#### Move 2 — Re-scope Tesla and JLR campaigns as tight demand-capture

*Why:* Certifications are rare and valuable. A searcher typing "tesla approved body shop near me" is worth $7 per click. A searcher typing "tesla" is not — ever.

*What:*
- Shrink keyword set to phrase + exact match around certification intent combined with brand:
  - `"tesla approved body shop"`, `[tesla certified collision repair]`, `"tesla approved body shop near me"`
  - `"jaguar certified collision"`, `"land rover certified body shop"`, `"range rover approved repairer"`
- Eliminate all single-word brand broad keywords: "tesla," "range rover," "land rover," "jaguar."
- Build a 300+ entry negative keyword list. Minimum starter categories: `parts`, `dealership`, `service center`, `customer service`, `for sale`, `used`, `price`, `battery`, `charger`, `model s|y|x|3`, `windshield`, `roadside`, `recall`, `warranty`, `mechanic`, `lease`, `review`, `specs`, `mpg`, `horsepower`, `0-60`, `vs`, `manual`, `owners manual`.
- Switch bidding strategy from Max Conversions to **Manual CPC**, or to Target CPA once tracking is clean. Max Conversions on a broken signal has no brakes.
- Restrict geo to `LOCATION_OF_PRESENCE` only, not `AREA_OF_INTEREST`. Current data shows roughly 40% of Tesla spend and 33% of JLR spend comes from users physically outside the service area.

#### Move 3 — Protect and scale PPC_Wallace_40Miles (the core)

*Why:* This campaign is the profitable channel. Even with broken tracking inflating numbers, the search-term data shows genuine local intent converting well: `wallace collision`, `collision repair near me`, `auto body shop near me`, `paint and body shop near me`, and competitor-conquest terms like `caliber collision`.

*What:*
- **Raise Quality Score before raising bids.** Split the mega "body shop" ad group into 3–5 intent-themed groups: `body shop`, `collision repair`, `paint`, `estimate`, `near me`. Each group gets 3 RSAs with keyword-anchored headlines and Kingsport location tokens.
- Phase out legacy BMM syntax. Keywords like `+auto +body +shop +near +me` have not functioned as broad-match modified since 2021 — the `+` signs are now treated as phrase match with extra noise.
- After tracking fix: switch from Max Conversions to **Target CPA** set at the true lead CPA (likely $50–90 range, not $1.82).
- Raise daily budget from $43 to $65–75 once bidding is recalibrated, to relieve rank-lost pressure.
- Add asset extensions:
  - Call assets with business-hour scheduling.
  - Location asset linked to Google Business Profile.
  - Sitelinks: "Insurance Accepted," "Certifications," "Lifetime Warranty," "Rental Assistance," "Free Estimate."
  - Callout assets: "OEM-Certified," "I-CAR Gold Class," "Paintless Dent Repair," "All Major Insurers."

#### Move 4 — Separate Wallace Ford of Kingsport

*Why:* Different business, different goals, different KPIs, different landing pages. Mixing dilutes attribution reporting and turns budget conversations into political ones.

*What:*
- Ideal: move the Ford brand Smart Campaign to its own Google Ads account under the same MCC.
- Minimum acceptable: if it stays, give it isolated conversion goals via goal-level campaign overrides so it does not share `primary_for_goal` with the collision campaigns.

### What we explicitly do NOT do (yet)

- **No Performance Max.** PMax needs a clean conversion signal first, and in small accounts it cannibalizes exact-match search instead of adding incremental volume.
- **No geo expansion.** The 40-mile radius is correct for collision repair. Customers do not drive 80 miles for a dent fix.
- **No Display, YouTube, or Discovery layers.** Fix the base first. Layer in retargeting of previous form-fill visitors only, once base is healthy.
- **No touching the Ford Smart Campaign.** Separate business, separate discussion.

---

## 30 / 60 / 90 Day Roadmap

| Phase | Days | Focus | Exit Criterion |
|-------|------|-------|----------------|
| 1. Measurement | 0–14 | Fix conversion actions, GA4 import, call-length threshold, offline RO import | Smart Bidding has one true "lead" signal + secondary engagement signals |
| 2. Waste elimination | 14–30 | Build negative lists, tighten match types on Tesla/JLR, LOP-only geo | ≥50% drop in non-collision search-term spend |
| 3. Structure rebuild | 30–60 | Split PPC_Wallace ad groups, write new RSAs, raise QS | Weighted-avg QS on top-spend keywords ≥6 |
| 4. Bidding migration | 60–75 | Max Conversions → tCPA with real target | tCPA campaigns steady-state within ±20% of target |
| 5. Expansion | 75–90 | Raise core budget, add call-only ads, build retargeting audience | Rank-lost IS on core below 50% |

---

## Expected Outcome (conservative estimate)

Same $4,040/month spend, post-optimization:

- **Real leads:** 40–70 per month (vs. current unmeasurable / inflated)
- **True CPA:** $55–85 (vs. reported fake $1.82)
- **Waste reduction:** $1,200–1,800/month freed from Tesla/JLR non-collision terms
- **Reinvested waste** into core local collision → projected **+30–50% qualified lead volume** within 90 days
- **Quality Score lift** from avg 3 → avg 6+ → roughly **2× effective CPC efficiency** on core keywords

---

## Open Decisions (need Nick's input before execution plan)

1. **Authority scope:** Do I propose edits for your approval, or am I authorized to make changes directly in the account?
2. **Ford brand campaign:** Separate out now, or defer to a different engagement?
3. **Lead definition:** Form + call ≥60s only? Or also include directions and store visits as secondary goals in Smart Bidding?
4. **Offline data availability:** Does Wallace export booked repair orders from their DMS in a format we can weekly-upload for offline conversion import?
5. **Target CPA ballpark:** What is the shop's target cost per booked RO? (Gives us `tCPA ceiling = RO close rate × target cost per RO`.)

Once these are answered, the next deliverable is an execution plan with:
- Specific keyword-level pause/add list
- Full negative-keyword lists per campaign
- Conversion-goal reconfiguration (step-by-step in Google Ads UI)
- Ad group restructure map
- RSA copy drafts

---

## Data Appendix

### Account snapshot
- **Currency:** USD
- **Time zone:** America/Chicago
- **Account type:** Client (not manager)
- **Test account:** No
- **Auto-tagging:** Enabled
- **Status:** ENABLED

### Conversion actions — full inventory (21 actions)

| Name | Status | Type | Category | Primary | In Metric | Counting |
|------|--------|------|----------|---------|-----------|----------|
| CROToolkitLandingPage | REMOVED | WEBPAGE | SUBMIT_LEAD_FORM | Yes | Yes | ONE_PER_CLICK |
| Landing Page | **ENABLED** | WEBPAGE | SUBMIT_LEAD_FORM | **Yes** | **Yes** | **MANY_PER_CLICK** ⚠️ |
| CROToolkitPopup | REMOVED | WEBPAGE | SUBMIT_LEAD_FORM | Yes | Yes | ONE_PER_CLICK |
| Local actions - Directions | ENABLED | GOOGLE_HOSTED | GET_DIRECTIONS | Yes | No | MANY_PER_CLICK |
| Clicks to call | ENABLED | GOOGLE_HOSTED | CONTACT | Yes | No | MANY_PER_CLICK |
| Local actions - Website visits | ENABLED | GOOGLE_HOSTED | PAGE_VIEW | Yes | No | MANY_PER_CLICK |
| Local actions - Other engagements | ENABLED | GOOGLE_HOSTED | ENGAGEMENT | Yes | No | MANY_PER_CLICK |
| Calls from ads | ENABLED | AD_CALL | PHONE_CALL_LEAD | Yes | Yes | MANY_PER_CLICK |
| Wallace Collision Center - GA4 purchase | HIDDEN | GA4_PURCHASE | PURCHASE | No | No | MANY_PER_CLICK |
| Local actions - Menu views | ENABLED | GOOGLE_HOSTED | PAGE_VIEW | Yes | No | MANY_PER_CLICK |
| Wallace Collision Center - GA4 close_convert_lead | HIDDEN | GA4_CUSTOM | PAGE_VIEW | No | No | MANY_PER_CLICK |
| Wallace Collision Center - GA4 qualify_lead | HIDDEN | GA4_CUSTOM | PAGE_VIEW | No | No | MANY_PER_CLICK |
| Store visits | ENABLED | STORE_VISITS | STORE_VISIT | Yes | No | MANY_PER_CLICK |
| Smart campaign map clicks to call | ENABLED | SC_MAP_CALLS | CONTACT | Yes | No | MANY_PER_CLICK |
| Wallace Ford of Kingsport (web) purchase | HIDDEN | GA4_PURCHASE | PURCHASE | No | No | MANY_PER_CLICK |
| Wallace Ford of Kingsport (web) click_to_call | HIDDEN | GA4_CUSTOM | PHONE_CALL_LEAD | No | No | MANY_PER_CLICK |
| Calls from Smart Campaign Ads | ENABLED | SC_TRACKED_CALLS | PHONE_CALL_LEAD | Yes | Yes | ONE_PER_CLICK |
| Smart campaign ad clicks to call | ENABLED | SC_AD_CALLS | CONTACT | Yes | Yes | MANY_PER_CLICK |
| Smart campaign map directions | ENABLED | SC_MAP_DIRECTIONS | GET_DIRECTIONS | Yes | No | MANY_PER_CLICK |
| **Form** | **ENABLED** | **GA4_CUSTOM** | **SUBMIT_LEAD_FORM** | **Yes** | **Yes** | **MANY_PER_CLICK** ⚠️ |
| Wallace Ford of Kingsport (web) all_elements | HIDDEN | GA4_CUSTOM | PAGE_VIEW | No | No | MANY_PER_CLICK |

Actions needing change flagged with ⚠️.

### Keyword performance highlights

**High-volume / high-cost keywords (Tesla campaign, all BROAD, mostly QS 2–3):**
- "tesla repair shop" — $1,440 · QS 3
- "tesla body shops" — $750 · QS 3
- "tesla auto body shops near me" — $653 · QS 2
- "tesla body repair" — $572 · QS 5
- "tesla repairs" — $334 · QS 3

**High-volume / high-cost keywords (JLR campaign, all BROAD, QS 0):**
- "jaguar certified collision repair" — $1,110 · QS 0
- "land rover collision center" — $747 · QS 0
- "range rover collision repair near me" — $673 · QS 0
- "land rover collision repair" — $220 · QS 0

**Best-performing keyword in the account:**
- `body shop estimates` — PPC_Wallace — QS 7 — $416 / 209 clicks / 219 conversions (note: conversions inflated by tracking issue)

### Geographic split

| Campaign | LOP Spend | AOI Spend | AOI Share |
|----------|-----------|-----------|-----------|
| PPC_Wallace_40Miles | $3,944 | $0 | 0% |
| Tesla Approved | $2,766 | $1,831 | ~40% |
| JLR Certified Collision | $1,841 | $911 | ~33% |
| Wallace Ford of Kingsport | $827 | $0 | 0% |

LOP = Location of Presence (user is physically in the service area). AOI = Area of Interest (user is searching about the area from elsewhere). For a local collision shop, AOI traffic rarely converts.

---

*End of strategy document.*
