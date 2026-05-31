# Wallace Collision — Tracking Setup
**Date:** 2026-05-06

---

## Priority Overview

Tracking is **the most critical step**. Nothing should be optimized until conversion tracking is clean. Smart Bidding trained on bad data produces bad results — as evidenced by the current account.

| Priority | Action | Blocking? |
|----------|--------|-----------|
| P0 | Fix conversion action configuration in Google Ads | Yes — all optimization blocked until done |
| P1 | Install Google Tag Manager (if not already) | Required for clean tag management |
| P1 | Set up Google LSA profile + verification | Required before LSA can go live |
| P1 | Deploy Meta Pixel | Required before any Meta campaigns launch |
| P2 | Set up CallRail (or Google Forwarding Numbers) | Required for call attribution |
| P2 | Verify GA4 events are firing correctly | Required for GA4 import accuracy |
| P3 | Offline conversion import (DMS → Google Ads) | High-value, not day-1 blocking |
| P3 | Meta CAPI (server-side) | Improves Meta attribution accuracy, not blocking |

---

## Step 1 — Google Ads Conversion Action Fix (Day 1–3)

### Actions Required in Google Ads UI

**Landing Page (WEBPAGE) — DEMOTE**
- Current: Primary for goal = YES, type = WEBPAGE, counting = MANY_PER_CLICK
- Change: Primary for goal → NO (set to Secondary)
- Reason: Page loads are not leads. This is corrupting all Smart Bidding.

**Form (GA4_CUSTOM) — FIX COUNTING**
- Current: counting = MANY_PER_CLICK
- Change: counting → ONE_PER_CLICK
- Reason: One form submit = one lead, even if they submit twice

**GA4 qualify_lead — UNHIDE + PROMOTE**
- Current: HIDDEN, not primary
- Change: Status → ENABLED, Primary for goal → YES
- Reason: This is the cleanest lead signal available

**Calls from ads (AD_CALL) — VERIFY THRESHOLD**
- Current: Primary (correct)
- Verify: Call length threshold is set to ≥60 seconds
- If not set: add call length condition in conversion settings

**Demote from Primary (remove from Smart Bidding signal):**
- Local actions - Directions
- Local actions - Website visits
- Local actions - Menu views
- Local actions - Other engagements
- Store visits

Keep all above as tracked/secondary — they have reporting value but should not influence bidding.

---

## Step 2 — Google LSA Setup (Day 1–7)

### Requirements
1. Google Business Profile(s) linked and verified for each location
2. Business license documentation ready
3. Insurance certificate ready (general liability)
4. Background check consent for technicians (Google Screened, if applicable)
5. Service categories: Collision repair, auto body repair, paintless dent repair

### Setup Steps
1. Go to ads.google.com/local-services-ads
2. Select "Auto Body Shop" category
3. Link existing Google Ads account
4. Submit documentation for Google Guaranteed badge
5. Set max per-lead bid: start at $50 (adjust based on CPL data week 2+)
6. Service area: same ZIP codes as PPC campaigns
7. Hours: match actual business hours

### Verification Timeline
Google Guaranteed approval: typically 3–10 business days.

---

## Step 3 — Meta Pixel (Day 1–7)

### Events to Configure

| Event | When to Fire | Priority |
|-------|-------------|----------|
| PageView | Every page | P1 |
| Lead | On form submission confirmation | P1 |
| Contact | On phone number click (tel: link) | P1 |
| ViewContent | On estimate/contact page view | P2 |
| InitiateCheckout | N/A for collision repair | Skip |

### Implementation
**Recommended:** via Google Tag Manager (add Meta Pixel base code + event tags in GTM)  
**Alternative:** hardcode into site header (less flexible)

### Meta Pixel Verification
- Use Meta Pixel Helper Chrome extension to verify events fire correctly
- Check Events Manager in Meta Business Manager within 24 hours of install
- Confirm Lead event fires on form thank-you page (not just form page load)

---

## Step 4 — Call Tracking (Day 1–14)

### Option A: Google Forwarding Numbers (no extra cost)
- Native to Google Ads
- Works for Google campaigns only
- Does not track Meta or organic calls separately
- Minimum viable option for Phase 1

### Option B: CallRail ($50–100/month, recommended)
- Separate tracking numbers per channel: LSA | Search | Brand | Meta | Organic
- Records calls (verify TN one-party consent compliance)
- Dynamic number insertion on website (swaps number based on traffic source)
- Integrates with GA4 and Google Ads
- Provides call transcripts and lead quality scoring

### CallRail Setup (if chosen)
1. Create account at callrail.com
2. Create a number pool for website visitors (dynamic insertion)
3. Create static numbers: one for each paid channel + organic
4. Place CallRail DNI script in site header (before </head>)
5. Connect to Google Ads via CallRail integration
6. Connect to GA4 via CallRail integration

### Call Qualification Rule
60-second minimum for a call to count as a qualified lead.  
Shorter calls: track as "micro-conversion" but do not include in CPL calculations.

---

## Step 5 — GA4 Verification (Day 7–14)

### Events to Verify Are Firing

| GA4 Event | Trigger | Note |
|-----------|---------|------|
| qualify_lead | Form submit on thank-you page | This is the key event to import into Google Ads |
| page_view | Every page | Should fire automatically via gtag or GTM |
| click_to_call | Click on tel: phone links | Needs GTM trigger or hardcoded event |
| session_start | Automatic | Verify |

### GA4 → Google Ads Import
1. In Google Ads: Tools → Conversions → Google Analytics 4
2. Import: `qualify_lead` event
3. Set as Primary for goal: YES
4. Attribution model: Data-driven (or Last Click if insufficient data)

---

## Step 6 — Offline Conversion Import (Day 30–60)

### If DMS Export is Available (CCC ONE, Mitchell, Audatex, etc.)
1. Export booked repair orders weekly (CSV)
2. Match on GCLID (Google Click ID — auto-tagging must be enabled)
3. Upload via Google Ads → Tools → Conversions → Offline Conversions
4. Use conversion action: "Booked Repair Order" (create new)

### GCLID Capture Requirement
- Form must capture and store the GCLID from the URL parameter `gclid=`
- Store in hidden form field + CRM/database
- Without GCLID, offline import cannot match leads to clicks

**This is the highest-value tracking improvement available** — ties ad dollars directly to actual revenue, not just leads.

---

## Step 7 — Meta CAPI (Month 2–3)

Server-side tracking via Meta Conversions API.  
Improves event match quality (EMQ) score, which directly affects Meta's ability to find more people like your converters.

**Setup options:**
1. Meta Conversions API Gateway (easiest — no code)
2. GTM Server-Side Container (flexible)
3. Direct API integration (requires developer)

**Target EMQ score:** ≥7.0/10 (with CAPI + Pixel combined)

---

## Tracking Health Dashboard (Weekly Checks)

| Check | Tool | Frequency | Alert Threshold |
|-------|------|-----------|-----------------|
| Conversion action counts | Google Ads | Weekly | <5 conversions in 7 days on any primary action |
| Call duration distribution | CallRail | Weekly | <30% calls are ≥60s (indicates bad traffic quality) |
| GA4 event volume | GA4 | Weekly | qualify_lead count diverges >20% from CallRail |
| Meta Pixel health | Events Manager | Weekly | EMQ <6.0 |
| LSA lead volume + disputes | LSA dashboard | Weekly | Any invalid leads — dispute immediately for credit |

---

## Open Questions (Need Client Input)

1. Does Wallace use a DMS (CCC ONE, Mitchell, Audatex)? Can they export ROs weekly?
2. Is there a website CMS where we can install GTM easily? What platform?
3. Are Google Business Profiles fully claimed and verified for all locations?
4. What is the existing call handling process — do calls go to a central line or location-specific?
5. Budget approval for CallRail (~$60–100/month)?
