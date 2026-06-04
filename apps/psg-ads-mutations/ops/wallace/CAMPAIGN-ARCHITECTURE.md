# Wallace Collision — Campaign Architecture
**Date:** 2026-05-06

---

## Naming Convention

```
[Platform]_[BusinessUnit]_[Objective]_[Audience/Keyword Theme]_[Date]
```

Examples:
- `GOOG_WAL_SRCH_LocalCollision_2026Q2`
- `GOOG_WAL_LSA_AllServices_2026Q2`
- `GOOG_WAL_SRCH_TeslaApproved_2026Q2`
- `META_WAL_RET_WebsiteVisitors_2026Q2`

---

## Google Ads Architecture

```
Google Ads Account (604-861-1995)
│
├── [NEW] LSA — Local Services Ads
│   └── Google Guaranteed profile — all collision services
│       ├── Auto body repair
│       ├── Collision repair
│       ├── Paintless dent repair
│       ├── Frame straightening
│       └── Insurance claim assistance
│
├── Brand Search — GOOG_WAL_SRCH_Brand_2026Q2
│   └── Ad Group: Wallace Brand Terms
│       ├── [exact] wallace collision
│       ├── [exact] wallace collision center
│       ├── [phrase] "wallace body shop"
│       └── [phrase] "wallace collision kingsport"
│       Bid strategy: Target Impression Share (top of page, 90%)
│
├── Core Local — GOOG_WAL_SRCH_LocalCollision_2026Q2
│   ├── Ad Group 1: Collision Repair
│   │   ├── [phrase] "collision repair kingsport"
│   │   ├── [phrase] "collision repair near me"
│   │   ├── [exact] collision repair kingsport tn
│   │   └── [exact] auto collision repair near me
│   ├── Ad Group 2: Body Shop
│   │   ├── [phrase] "body shop near me"
│   │   ├── [phrase] "auto body shop kingsport"
│   │   ├── [exact] body shop kingsport tn
│   │   └── [exact] body shop estimates
│   ├── Ad Group 3: Paint & Dent
│   │   ├── [phrase] "auto paint shop kingsport"
│   │   ├── [phrase] "paintless dent repair near me"
│   │   ├── [phrase] "dent repair kingsport"
│   │   └── [exact] car dent repair near me
│   ├── Ad Group 4: Estimate / Insurance
│   │   ├── [phrase] "free auto body estimate"
│   │   ├── [phrase] "collision estimate near me"
│   │   ├── [exact] insurance body shop near me
│   │   └── [exact] auto body estimate near me
│   └── Ad Group 5: Competitor Conquest
│       ├── [exact] caliber collision kingsport
│       ├── [exact] service king kingsport
│       └── [phrase] "crash champions near me"
│       Note: Run competitor terms in separate ad group, lower bids
│       Bid strategy: Maximize Conversions → tCPA $75 after 30 conversions
│
├── Tesla Certified — GOOG_WAL_SRCH_TeslaApproved_2026Q2 [REBUILT]
│   └── Ad Group: Tesla Approved Collision Only
│       ├── [exact] tesla approved body shop
│       ├── [exact] tesla certified collision repair
│       ├── [phrase] "tesla approved body shop near me"
│       ├── [phrase] "tesla collision repair near me"
│       └── [phrase] "tesla body shop"
│       NEGATIVES: See global negative list below
│       Geo: Location of Presence ONLY (75-mile radius from Kingsport)
│       Bid strategy: Manual CPC (Max $20/click) until tracking clean → then tCPA
│
├── JLR Certified — GOOG_WAL_SRCH_JLRCertified_2026Q2 [REBUILT]
│   └── Ad Group: JLR Certified Collision Only
│       ├── [exact] jaguar certified collision
│       ├── [exact] land rover certified body shop
│       ├── [phrase] "jaguar certified collision repair"
│       ├── [phrase] "land rover collision center near me"
│       ├── [phrase] "range rover approved repairer"
│       └── [phrase] "range rover body shop near me"
│       NEGATIVES: See global negative list below
│       Geo: Location of Presence ONLY (75-mile radius from Kingsport)
│       Bid strategy: Manual CPC (Max $25/click) until tracking clean → then tCPA
│
├── Toyota Certified — GOOG_WAL_SRCH_ToyotaCertified_2026Q2 [NEW — Priority]
│   └── Ad Group: Toyota Collision Care Only
│       ├── [exact] toyota certified body shop
│       ├── [exact] toyota collision care center
│       ├── [phrase] "toyota certified collision repair"
│       ├── [phrase] "toyota body shop near me"
│       ├── [phrase] "toyota certified repair near me"
│       └── [phrase] "toyota approved body shop"
│       NEGATIVES: parts, dealership, service center, for sale, used, price, lease,
│                  toyota tacoma parts, toyota camry price, toyota rav4 review,
│                  toyota dealer, toyota finance, toyota service, toyota oil change,
│                  toyota tires, toyota recall, how to, diy, manual
│       Geo: Location of Presence ONLY (75-mile radius)
│       Bid strategy: Manual CPC (Max $15/click) → tCPA after clean signal
│       Note: Toyota has highest volume of the three certified brands — budget here first
│
└── [FUTURE — Day 75+] Retargeting Display
    └── Website visitors 30 days (once pixel pool ≥500 users)

SEPARATED: Wallace Ford of Kingsport → own account under MCC
```

---

## Meta Ads Architecture

```
Meta Business Manager
│
└── Wallace Collision — Ad Account
    │
    ├── Retargeting — META_WAL_RET_WebsiteVisitors_2026Q2
    │   ├── Ad Set 1: All Website Visitors (30 days)
    │   │   └── Audience: Website Custom Audience, 30-day window
    │   │   Budget: $150/month
    │   └── Ad Set 2: High-Intent Visitors (viewed estimate/contact page)
    │       └── Audience: URL-level custom audience (estimate, contact pages)
    │       Budget: $100/month
    │
    ├── Local Awareness — META_WAL_PROS_LocalAwareness_2026Q2
    │   └── Ad Set 1: Kingsport Metro Homeowners
    │       ├── Geo: 20-mile radius, each location
    │       ├── Age: 28–65
    │       ├── Interest: Auto ownership, recently moved, homeownership
    │       └── Budget: $150/month
    │
    └── [FUTURE — Month 3] Certified Owner Prospecting
        └── Ad Set: Luxury Car Owners
            ├── Interest: Tesla, Land Rover, Jaguar
            ├── Geo: 75-mile radius (wider for certified)
            └── Budget: $200/month (once pixel has enough data)
```

---

## Negative Keyword Lists

### Global (all campaigns)

**Employment / Education:**
jobs, career, hiring, salary, training, apprentice, school, course, certification course, how to become, learn to

**DIY / Informational:**
diy, how to, tutorial, guide, youtube, reddit, forum, wikipedia, history of

**Non-collision services:**
mechanic, engine, transmission, oil change, tire, alignment, brake, smog, inspection, emissions, muffler, exhaust, ac repair, car ac

**Parts / Aftermarket:**
parts, oem parts, aftermarket, for sale, buy, cheap, discount, wholesale, ebay, amazon

**Research / Non-buying:**
review, vs, compare, mpg, horsepower, specs, 0-60, price, msrp, invoice price, lease, finance

### Tesla Campaign Additional Negatives

tesla dealership, tesla service center, tesla customer service, tesla battery, tesla charger, tesla supercharger, tesla roadside, tesla warranty, tesla model s, tesla model 3, tesla model x, tesla model y, tesla cybertruck, tesla semi, tesla stock, tesla news, tesla recall, used tesla, tesla for sale, tesla owner, tesla app, tesla autopilot, tesla fsd, tesla software, new tesla, tesla price, tesla tax credit, tesla delivery, tesla knoxville, tesla nashville, tesla charlotte

### JLR Campaign Additional Negatives

jaguar dealership, jaguar for sale, jaguar price, jaguar lease, jaguar parts, jaguar service, jaguar maintenance, land rover dealership, land rover for sale, range rover for sale, range rover price, used land rover, used range rover, land rover parts, land rover service, jaguar f-pace, jaguar e-pace, jaguar xe, jaguar xf, jaguar i-pace, range rover sport, range rover velar, discovery sport, defender, land rover dealer

---

## Conversion Action Configuration

### Actions to KEEP PRIMARY (feeds Smart Bidding)
| Action | Type | Counting | Threshold |
|--------|------|----------|-----------|
| Calls from ads | AD_CALL | MANY_PER_CLICK | ≥60 seconds |
| Form | GA4_CUSTOM | **ONE_PER_CLICK** (fix from MANY) | Any submit |
| GA4 qualify_lead | GA4_CUSTOM | ONE_PER_CLICK | **Unhide + promote** |

### Actions to DEMOTE TO SECONDARY (tracked, not optimized)
- Landing Page (WEBPAGE) — demote to secondary
- Directions
- Website visits
- Menu views
- Other engagements
- Store visits

### Actions to REMOVE / ARCHIVE
- CROToolkitLandingPage (REMOVED status — archive)
- CROToolkitPopup (REMOVED status — archive)

---

## Ad Extensions (All Google Search Campaigns)

### Call Assets
- Primary: Main collision center phone
- Business hours: Mon–Fri 8am–5pm, Sat 9am–1pm (adjust per location)

### Location Assets
- Link all active Google Business Profile locations

### Sitelinks (6)
1. Free Estimate → /estimate
2. Insurance Accepted → /insurance
3. Tesla Approved → /certifications
4. JLR Certified → /certifications
5. Lifetime Warranty → /warranty
6. Contact Us → /contact

### Callout Assets
- I-CAR Gold Class
- OEM Certified Repairs
- All Major Insurers Accepted
- Lifetime Warranty on Repairs
- Free Estimates
- Rental Assistance Available

### Structured Snippets — Service Types
Collision Repair, Auto Body Repair, Paint & Refinish, Frame Repair, Paintless Dent Removal, Glass Repair, Hail Damage

---

## Multi-Location Considerations

- Separate ad groups by location (or location ad groups within campaigns) if locations serve distinct sub-markets
- Location assets linked to all GBP listings
- Consider separate campaigns per location if budgets allow and locations are >15 miles apart
- LSA: configure separate LSA profiles per location to maximize coverage
