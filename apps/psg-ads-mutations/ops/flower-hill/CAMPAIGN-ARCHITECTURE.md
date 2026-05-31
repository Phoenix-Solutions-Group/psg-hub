# Flower Hill Auto Body — Campaign Architecture
**Last updated:** May 2026

---

## Naming Convention

```
[Platform]_[Location]_[Segment]_[Objective]_[YYYYMM]
```

**Examples:**
- `GOOG_HTN_General_Search_202606`
- `META_GC_Luxury_Prospecting_202606`
- `LSA_ROS_General_LeadGen_202606`

**Location codes:** HTN = Huntington | GC = Glen Cove | ROS = Roslyn | NS = North Shore (multi-loc)

---

## Google Ads Architecture

### Account Structure
```
Flower Hill Auto Body — Google Ads
│
├── [HTN] Huntington
│   ├── LSA Campaign (pay-per-lead)
│   │   └── All auto body services listed
│   │
│   ├── Brand Search
│   │   └── Ad Group: "Flower Hill" + brand variants
│   │
│   ├── General Collision (Search) ← Tier 1 + Tier 2 keywords
│   │   ├── Ad Group: Near Me — General
│   │   │   Keywords: [body shop near me], [collision repair near me], [auto body near me]
│   │   │   [auto body shop near me], [car body shop near me] — radius 12mi from HTN
│   │   ├── Ad Group: Huntington-Specific
│   │   │   Keywords: [huntington auto body], [huntington collision center]
│   │   │   [huntington auto body and paint], [auto body shop huntington ny]
│   │   ├── Ad Group: Insurance Claims
│   │   │   Keywords: [insurance collision repair], [accident repair shop near me]
│   │   │   [certified collision center], [certified collision repair]
│   │   └── Ad Group: Dent/Paint
│   │       Keywords: [dent repair huntington], [auto paint shop long island]
│   │
│   ├── EV Monopoly (Search) ← Tier 3 — ZERO competition, launch Day 1
│   │   ├── Ad Group: Rivian
│   │   │   Keywords: [rivian certified collision center], [rivian body shop]
│   │   │   [rivian collision repair]
│   │   ├── Ad Group: Lucid / EV General
│   │   │   Keywords: [lucid collision repair], [electric vehicle collision repair]
│   │   │   [EV body shop], [ev collision repair long island]
│   │   └── Ad Group: Tesla + Other EV
│   │       Keywords: [tesla body shop long island], [tesla collision repair near me]
│   │
│   └── Exotic / Luxury Search (Search) ← Tier 4 keywords
│       ├── Ad Group: Aston Martin (monopoly)
│       │   Keywords: [aston martin body shop], [aston martin repair near me]
│       │   [aston martin long island], "aston martin certified repair"
│       ├── Ad Group: Exotic Certifications
│       │   Keywords: [ferrari repair near me], [lamborghini certified repair]
│       │   [mclaren collision repair], "exotic car body shop long island"
│       ├── Ad Group: Luxury German
│       │   Keywords: [audi body shop near me], [audi certified collision repair]
│       │   [porsche body shop], [porsche collision repair long island]
│       │   [bmw collision repair long island]
│       └── Ad Group: OEM Certified Broad
│           Keywords: [oem certified collision repair], [manufacturer certified body shop]
│           [factory authorized collision repair long island]
│
├── [GC] Glen Cove
│   ├── LSA Campaign
│   ├── Brand Search
│   ├── General Collision (Search)
│   │   ├── Ad Group: Auto Body — Glen Cove
│   │   ├── Ad Group: Insurance Claims
│   │   └── Ad Group: Dent/Paint
│   └── Exotic / Luxury Search
│       └── [same structure as Huntington]
│
└── [ROS] Roslyn
    ├── LSA Campaign
    ├── Brand Search
    ├── General Collision (Search)
    │   ├── Ad Group: Auto Body — Roslyn
    │   ├── Ad Group: Insurance Claims
    │   └── Ad Group: Dent/Paint
    └── Exotic / Luxury Search
        └── [same structure as Huntington]
```

### Google Keyword Strategy (SEMrush Validated — May 2026)

#### Tier 1 — "Near Me" High Volume (Primary Revenue Driver)
| Keyword | Monthly Volume | CPC | Match Type |
|---------|---------------|-----|------------|
| body shop near me | 74,000 | $2.88 | Phrase |
| body shops near me | 90,500 | $2.88 | Phrase |
| collision repair near me | 60,500 | $3.32 | Phrase |
| auto body shop near me | 60,500 | $2.92 | Phrase |
| car body shop near me | 14,800 | $2.92 | Phrase |
| auto body near me | 12,100 | $3.02 | Phrase |
| collision center near me | 12,100 | $3.31 | Exact |
| body repair shops near me | 3,600 | $3.03 | Phrase |
| certified collision center | 1,900 | $2.27 | Exact |
| certified collision repair | 590 | $2.60 | Exact |

**Geo strategy:** Radius targeting (12-15mi per location) replaces city-in-keyword. "Near me" terms are resolved by Google location, not keyword text.

#### Tier 2 — Huntington-Specific (Priority Location Only)
| Keyword | Monthly Volume | CPC | Match Type | Note |
|---------|---------------|-----|------------|------|
| huntington auto body | 210 | $1.60 | Exact | DePalo ranks #13-31 organically; zero paid competition |
| huntington collision center | 170 | $1.89 | Exact | Zero paid competition |
| huntington auto body and paint | 170 | $1.60 | Exact | DePalo #14 organically |
| auto body shop huntington ny | 20 | est. $3-5 | Exact | Very local, high intent |

**Note:** $200-300/mo captures all Huntington-specific intent. DePalo's mid-page organic rankings cannot defend against paid top-of-page placement.

#### Tier 3 — EV Monopoly (Zero Paid Competition Nationwide)
| Keyword | Monthly Volume | CPC | Match Type | Trend |
|---------|---------------|-----|------------|-------|
| rivian certified collision center | 880 | $5.29 | Exact | Peak (1.00) — sustained high |
| rivian body shop | 390 | $4.45 | Exact | Peak (1.00) — surging |
| rivian collision repair | 390 | $4.96 | Phrase | Strongly rising |
| electric vehicle collision repair | 110 | $3.85 | Exact | Exploding (0.33→1.00) |
| lucid collision repair | 40 | $16.72 | Exact | Rising — ultra-motivated searcher |
| EV body shop | 30 | $2.57 | Phrase | Rising |

**No advertiser in the US is currently bidding on "rivian certified collision center," "lucid collision repair," or "electric vehicle collision repair."** CPCs represent the floor before competition enters — budget now while it's cheap.

#### Tier 4 — Luxury Brand Keywords (Zero Paid Competition)
| Keyword | Monthly Volume | CPC | Match Type | FH Organic Rank |
|---------|---------------|-----|------------|----------------|
| aston martin body shop | 140 | $59.86 | Exact | Not ranking → paid required |
| aston martin repair near me | 90 | $2.75 | Exact | Not ranking |
| aston martin long island | 480 | $2.23 | Phrase | #26 organically |
| ferrari repair near me | 320 | $2.94 | Exact | #14 organically |
| audi body shop near me | 320 | $4.43 | Exact | **#9 organically** — double presence |
| porsche body shop | 320 | $5.38 | Exact | #89 → paid bridges gap |
| audi certified collision repair | 320 | $6.70 | Exact | #46 organically |
| subaru collision repair | 390 | $3.32 | Phrase | #82 organically |

**Aston Martin at $59.86 CPC:** One repair job on an Aston Martin averages $8,000-$25,000+. The CPC is irrelevant vs. conversion value. Only Flower Hill on Long Island can legitimately capture this search.

#### Negative Keywords (All Campaigns)
DIY, how to fix, training, school, jobs, salary, careers, hiring, cheap, junkyard, salvage, parts only, used parts, wrecking yard, how much does it cost (informational)

### Google Ad Copy Templates

#### General Tier RSA Headlines (15 needed, mix and match)
1. Collision Repair in Huntington, NY
2. Free Estimates — Call Today
3. North Shore's Trusted Auto Body Shop
4. All Insurance Accepted
5. 3 North Shore Locations Near You
6. Certified Collision Repair Specialists
7. Get Back on the Road Fast
8. Family-Owned Since [Year]
9. 5-Star Rated Auto Body Shop
10. We Handle the Insurance Claim
11. OEM Parts — Factory-Quality Repairs
12. Huntington, Glen Cove & Roslyn
13. Call [Phone] for Same-Day Estimate
14. Trusted by Long Island Drivers
15. Exotic Car Certified — All Makes Welcome

#### General Tier Descriptions (4 needed)
1. From minor dents to major collision damage, our certified technicians restore your vehicle to pre-accident condition. Free estimates, all insurance accepted.
2. Serving the North Shore since [Year]. Three convenient locations in Huntington, Glen Cove, and Roslyn. Call for your free estimate today.
3. We handle your insurance claim from start to finish. No stress, no hassle — just expert collision repair and a vehicle that looks like the accident never happened.
4. OEM-certified facility. We use manufacturer-approved parts and processes to restore your vehicle's safety, value, and appearance. All makes and models welcome.

#### Exotic Tier RSA Headlines
1. Aston Martin Certified Body Shop — LI
2. Lamborghini & McLaren Certified Repair
3. Long Island's Exotic Car Collision Specialists
4. Factory-Certified Exotic Car Restoration
5. OEM Certified: Aston Martin, McLaren, More
6. Your Exotic Car Deserves Certified Care
7. North Shore's Premier Exotic Car Repair
8. Trusted by Exotic Car Owners Since [Year]
9. Schedule Your Exotic Car Assessment
10. McLaren-Certified. Lamborghini-Certified.

#### Exotic Tier Descriptions
1. One of the few shops on Long Island certified by Aston Martin, Lamborghini, and McLaren. Your exotic car will be repaired to exact manufacturer specifications — nothing less.
2. Factory OEM certifications mean we have the training, tools, and approved parts your exotic vehicle requires. Three North Shore locations. Schedule your assessment today.

---

## Meta / Instagram Architecture

```
Flower Hill Auto Body — Meta Ads
│
├── [PROSPECTING] General — All Locations
│   ├── Campaign: FHAB_NS_General_Awareness
│   │   └── Ad Set: North Shore LI | 15mi radius | Age 28-60 | All income
│   │       Creative: Before/after, team photos, review highlights, location callout
│   │
│   └── Campaign: FHAB_NS_General_LeadGen
│       └── Ad Set: North Shore LI | 15mi radius | Age 28-55
│           Creative: "Free estimate" offer, insurance messaging, CTA → call or form
│
├── [PROSPECTING] Luxury/Exotic — All Locations
│   ├── Campaign: FHAB_NS_Luxury_Awareness
│   │   ├── Ad Set A: Luxury auto interests | Age 35-65 | Top 25% income | 20mi
│   │   │   Interests: Exotic cars, luxury vehicles, Porsche, Ferrari, car shows
│   │   └── Ad Set B: High-income zip codes (Old Westbury, Oyster Bay, Lloyd Neck)
│   │       Creative: Exotic car content, certification badges, prestige positioning
│   │
│   └── Campaign: FHAB_NS_Luxury_LeadGen
│       └── Ad Set: Luxury auto owners, HHI $200k+, 25mi radius
│           Creative: "Certified by Aston Martin" headline, assessment CTA
│
├── [HUNTINGTON PRIORITY] Huntington Launch Push
│   └── Campaign: FHAB_HTN_Launch_LeadGen
│       └── Ad Set: 10mi radius from Huntington | Age 25-60 | All income
│           Creative: "Now Open in Huntington" or "Huntington's premier body shop"
│
└── [RETARGETING] Website Visitors + Engagers
    └── Campaign: FHAB_NS_Retargeting
        ├── Ad Set: Website visitors (30 days) — all pages
        ├── Ad Set: Instagram/Facebook engagers (60 days)
        └── Creative: Testimonials, trust signals, direct CTA to call
```

### Meta Targeting Parameters

| Audience | Age | Income | Radius | Interests/Behaviors |
|----------|-----|--------|--------|---------------------|
| General prospecting | 28-60 | All | 15mi per location | Auto insurance, car maintenance |
| Luxury prospecting | 35-65 | Top 25% | 20mi | Exotic cars, luxury vehicles, car shows, Porsche/Ferrari owners |
| High-value ZIP | 35-65 | Top 10% | ZIP list | Old Westbury, Oyster Bay, Locust Valley, Lloyd Neck, Cold Spring Harbor |
| Retargeting | All | All | 25mi | Website visitors, IG/FB engagers |

---

## Extensions Checklist (Google)

Per campaign, verify these are active:
- [ ] Call extension (primary number per location)
- [ ] Location extension (linked to Google Business Profile)
- [ ] Sitelinks: Services | About Us | Exotic Certifications | Reviews | Contact
- [ ] Callout: Free Estimates | All Insurance Accepted | OEM Certified | [X] Years Experience
- [ ] Structured snippets — Services: Collision Repair, Dent Repair, Paint, Frame Straightening, Exotic Car Repair
- [ ] Lead form extension (backup to call)
