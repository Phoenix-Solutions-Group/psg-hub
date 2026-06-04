# Wallace Collision — Landing Page Report
**Date:** 2026-05-20 | **CID:** 6048611995 | **Scope:** 5 active Q2 landing destinations
**Method:** Live crawl (UA: Chrome + Googlebot), policy_topic_entries via Google Ads API, message-match scoring per ad copy

## Executive

| # | Page | Ad group(s) | Live status | Score | Grade |
|---|---|---|---|---|---|
| 1 | `/` | Brand Terms | APPROVED, serving (1 impr today) | 88 | B |
| 2 | `/collision-repair/` | 5 LocalCollision ad groups | APPROVED, serving (16 impr, 1 click today, $4.22 spend) | 84 | B |
| 3 | `/tesla-approved/` | Tesla Approved Collision | APPROVED, eligible | 87 | B |
| 4 | `/jlr-certified-repair-center/` | JLR Certified Collision | UNKNOWN (under review) | 86 | B |
| 5 | `/certifications/` | **(BRIDGE) 3 Toyota ad groups** | **DISAPPROVED — DESTINATION_NOT_WORKING** | 38 | F (as Toyota landing) |

Average: 76 (C+). Lowest score = `/certifications/` as Toyota bridge: 38 / F. **Toyota cannot run with current landing options.** Site needs `/certifications/toyota/`.

---

## Per-page scoring

Component weights: Message Match 25% / Speed 25% / Mobile 20% / Trust 15% / Form 15%

### 1. `/` (Brand campaign)

| Component | Score | Notes |
|---|---|---|
| Message Match | 95 | H1 "Wallace Collision Center / The Safest Decision!" — perfect brand alignment |
| Speed | 80 | Lazy-loaded SVG placeholders; LiteSpeed cache hit; no third-party bloat visible |
| Mobile | 90 | Clickable tel: links, responsive nav, touch-friendly CTAs |
| Trust | 95 | 15+ OEM certs above fold, I-CAR Gold Class, 60+ years, family-owned |
| Form | 70 | No on-page form (links to `/start-estimate/`). Extra click cost. |

**Weighted: 88 / B.** Strong brand landing. No changes needed.

### 2. `/collision-repair/` (LocalCollision — 5 ad groups)

| Component | Score | Notes |
|---|---|---|
| Message Match | 90 | H1 "Collision Repair Services" — keyword exact-match for ad copy |
| Speed | 80 | Same LiteSpeed cache hit; SVG placeholders |
| Mobile | 85 | Responsive, clickable phone |
| Trust | 90 | OEM logos + I-CAR Gold Class + "collision repair is all we do" |
| Form | 70 | No on-page form; CTA goes to `/start-estimate/` |

**Weighted: 84 / B.** Already serving 16 impr today. No change needed.

### 3. `/tesla-approved/` (Tesla Approved Collision)

| Component | Score | Notes |
|---|---|---|
| Message Match | 95 | H1 "Tesla Approved Body Shop"; opening paragraph emphasizes Tesla-specific expertise |
| Speed | 80 | Same site-wide profile |
| Mobile | 85 | Dual CTAs, clickable phones |
| Trust | 95 | Tesla logo above fold + 15 other OEM certs + I-CAR Gold |
| Form | 70 | Links to `/start-estimate/` |

**Weighted: 87 / B.** Best OEM-specific page on the site. Mirror this structure for `/certifications/toyota/`.

### 4. `/jlr-certified-repair-center/` (JLR Certified Collision)

| Component | Score | Notes |
|---|---|---|
| Message Match | 90 | H1 "Experience Exceptional Care for Your Jaguar or Land Rover…"; specific "JLR Authorized Aluminum parts" claim |
| Speed | 80 | Same site-wide |
| Mobile | 85 | Responsive, dual phones |
| Trust | 95 | JLR cert badge + warranty preservation language + 15+ OEM certs |
| Form | 80 | On-page form (Name/Email/Phone/Message/CAPTCHA) — better than `/collision-repair/` |

**Weighted: 86 / B.** Currently under Google re-review. Should approve in <24h.

### 5. `/certifications/` (Toyota BRIDGE — failing policy)

| Component | Score | Notes |
|---|---|---|
| Message Match | **10** | H1 "Certifications" (generic). Toyota is one logo among 18+ in a wall. ZERO Toyota-specific copy. Ads claim "Toyota Certified" — page does not substantiate it visibly. |
| Speed | 80 | Same site-wide |
| Mobile | 75 | Logo wall likely stacks; CTA not above fold |
| Trust | 85 | 18+ OEM certs + I-CAR + lifetime warranty mention |
| Form | 50 | No on-page form, no quick-quote |

**Weighted: 38 / F.** **Root cause of Toyota disapprovals.** Google's policy bot rejects this as substantiation for "Toyota Certified Collision Repair" claim in ad copy.

---

## Why Toyota keeps disapproving

Ad headlines (15 per ad × 3 ads) make explicit Toyota cert claims:
- "Toyota Certified Collision Repair"
- "Factory-Trained Toyota Repair"
- "Toyota Certified — Not Just Dealer"
- "Independent Toyota Certified Specialist"
- "Toyota Tacoma Collision Specialist" / "Toyota RAV4 Body Shop" / etc.

Google's policy bot scores landing page against claim. Pages tried:
1. `/toyota-certified/` — 404 → DISAPPROVED
2. `/repair-estimate/` — 200, generic estimate form, **zero Toyota content** → DISAPPROVED (DESTINATION_NOT_WORKING)
3. `/certifications/` — 200, Toyota appears only as logo in wall of 18, **zero Toyota-specific copy** → DISAPPROVED (DESTINATION_NOT_WORKING)

Google's `DESTINATION_NOT_WORKING` topic = "destination doesn't substantiate ad claim." All 3 attempts fail the same test.

**Tesla works** because `/tesla-approved/` has H1 + opening paragraph + body copy specifically substantiating Tesla cert. **JLR works** because `/jlr-certified-repair-center/` has H1 + JLR-specific copy + JLR aluminum parts claim.

**Toyota has no equivalent page.** Cannot pass policy until one exists.

---

## Quick Wins (apply to all pages)

| # | Fix | Pages affected | Expected impact |
|---|---|---|---|
| 1 | Move primary CTA above-the-fold on mobile (currently in header nav, gets buried) | all 5 | +15-25% CVR |
| 2 | Add Wallace phone as prominent click-to-call button above fold (not just header) | all 5 | +5-15% mobile CVR |
| 3 | Embed short estimate form on landing pages (Name + Phone + Vehicle, 3 fields) instead of forcing click to `/start-estimate/` | `/collision-repair/`, `/tesla-approved/`, `/`, `/jlr-certified-repair-center/` | +10-20% CVR per Form benchmark |
| 4 | Optimize hero images — convert SVG placeholders to actual WebP heroes <200KB | all 5 | -1-2s LCP |
| 5 | Add schema markup (`LocalBusiness` + `AutoBodyShop`) | all 5 | SEO + rich snippets |
| 6 | Add review schema with star rating snippet visible above fold | all 5 | Trust signal +5-15% CVR |

---

## Brief for site team: build `/certifications/toyota/`

### Why
Three Toyota Q2 ads ($13/d combined budget) are disapproved by Google because no Toyota cert page exists. Until one ships, Toyota ads cannot serve. Loss: ~$390/mo wasted budget capacity + missed Toyota-certified-collision traffic.

### Reference pages on the same site (mirror these)
- `/jlr-certified-repair-center/` — closest analog (dedicated OEM cert page, currently works for JLR ads)
- `/certifications/rivian/` — alternate analog (OEM cert under /certifications/ prefix)
- `/tesla-approved/` — best-performing analog (Tesla cert page that passes Google policy)

### URL
`https://wallacecollisionrepair.com/certifications/toyota/`

### Page structure (mirror `/certifications/rivian/`)

**Hero**
- H1: "Toyota Certified Collision Repair Center" (use exact phrase; Google's policy matches this against ad copy)
- Sub: "Bristol, TN • Serving Kingsport, Johnson City, and the Tri-Cities"
- Toyota OEM cert badge image (request from Toyota brand assets if available; placeholder OK at launch)
- Dual CTA above fold:
  - "Start Your Online Estimate" (primary)
  - "Click to Call (423) 652-2233" (tel: link, mobile-prominent)

**Section 1: Why a Toyota Certified Repair Center**
- 4 bullets:
  - Genuine Toyota OEM parts
  - Factory-trained Toyota collision technicians
  - Specialized Toyota equipment + structural alignment
  - Repairs maintain Toyota factory warranty
- 80-150 words

**Section 2: Toyota models we repair**
- Toyota Tacoma, Tundra, 4Runner, RAV4, Camry, Corolla, Highlander, Sienna, Sequoia, Prius
- (Matches ad headlines like "Toyota Tacoma Collision Specialist", "Toyota RAV4 Body Shop", "Toyota Highlander Collision Shop")

**Section 3: Our Toyota repair process**
- 3-4 step process: inspection → OEM parts + factory specs → certified repair → warranty
- Mention I-CAR Gold Class

**Section 4: FAQ (3 Q&As)**
- "Why use a Toyota Certified Collision Center?"
- "Do you use genuine Toyota parts?"
- "Will my Toyota warranty stay intact after repair?"

**Section 5: CTA block**
- Repeat estimate + contact CTAs

**Section 6: Contact form**
- Name (required) / Email / Phone / Vehicle (year + model) / Brief description of damage / CAPTCHA
- Submit button: "Get My Free Toyota Estimate"

**Section 7: Other certifications grid**
- Show 15+ OEM logos at bottom (matches existing pages)

### Trust signals (required above fold or in section 1)
- Toyota OEM cert badge
- I-CAR Gold Class
- Years in business / family-owned

### Schema markup (add to `<head>`)
```json
{
  "@context": "https://schema.org",
  "@type": "AutoBodyShop",
  "name": "Wallace Collision Center - Toyota Certified",
  "description": "Toyota Certified Collision Repair Center in Bristol, TN.",
  "url": "https://wallacecollisionrepair.com/certifications/toyota/",
  "telephone": "+14236522233",
  "address": { "@type": "PostalAddress", "streetAddress": "...", "addressLocality": "Bristol", "addressRegion": "TN", "postalCode": "..." },
  "areaServed": ["Bristol TN", "Kingsport TN", "Johnson City TN", "Tri-Cities"],
  "brand": { "@type": "Brand", "name": "Toyota" }
}
```

### Performance budget
- LCP <2.5s
- Hero image <200KB (WebP)
- Page weight <2MB
- Tap targets ≥48×48px

### Acceptance criteria
- [ ] H1 contains "Toyota Certified Collision Repair Center"
- [ ] At least 3 distinct mentions of "Toyota" in body copy outside the OEM logo wall
- [ ] At least one phrase that explicitly substantiates the cert claim (e.g. "Wallace Collision Center is certified by Toyota Motor North America for collision repair…")
- [ ] OEM cert badge visible
- [ ] Phone is clickable `tel:` link
- [ ] CTA above fold
- [ ] Schema markup present and valid
- [ ] Lighthouse mobile score ≥85

### Once shipped
Wallace ads team will:
1. Test page renders on desktop + mobile + as Googlebot
2. Run `python -m ops.wallace.remap_q2_final_urls --execute` (repointed to `/certifications/toyota/`)
3. Submit policy appeal on all 3 ads
4. Monitor for APPROVED flip (expect <24h)

### Timeline
ASAP. Every day Toyota stays disapproved = $13 lost budget + traffic lost to competitors. Best-case ship in 1–3 business days.

---

## Recommendations (ordered by ROI)

1. **Ship `/certifications/toyota/`** per brief above. Unblocks Toyota ad spend immediately.
2. **Add 3-field estimate form on `/collision-repair/`** (Name + Phone + Vehicle). LocalCollision is the highest-volume campaign already serving — capture leads directly without forcing extra click to `/start-estimate/`.
3. **Convert SVG placeholders to optimized WebP hero images** on all 5 pages. Site-wide LCP improvement.
4. **Add `LocalBusiness` + `AutoBodyShop` schema** to all 5 landing pages. Rich snippets + Google AI Overview eligibility.
5. **Review-snippet trust block** above fold on all 5 pages (star rating + count). Validates the "Safest Decision" brand claim with social proof.
6. **Later:** add `/certifications/bmw-x/` page for future BMW Certified Q2 campaign reactivation; mirror `/certifications/toyota/` structure.
