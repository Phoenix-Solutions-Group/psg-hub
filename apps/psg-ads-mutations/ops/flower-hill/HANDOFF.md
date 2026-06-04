# Flower Hill Auto Body — Session Handoff
**Date:** 2026-05-06  
**Project:** Paid Ad Campaign + Landing Pages  
**Client:** Flower Hill Auto Body (PSG client, nick@phoenixsolutionsgroup.net)

---

## What Was Built This Session

### 1. Ad Creative — Higgsfield Image Generation
6 priority ad images generated and saved (Concepts 1 + 3 only — highest-arbitrage keywords):

| File | Concept | Platform | Subject |
|------|---------|----------|---------|
| `ad-assets/meta/concept-1/feed-1080x1080.png` | EV Certified | Meta Feed | Rivian R1S, charcoal bg |
| `ad-assets/stories/concept-1/stories-1080x1920.png` | EV Certified | Stories | Rivian R1T side, rim light |
| `ad-assets/google/concept-1/google-display-1200x628.png` | EV Certified | Google Display | Long Island map, red pins |
| `ad-assets/meta/concept-3/feed-1080x1080.png` | Exotic | Meta Feed | Aston Martin rear, pure black |
| `ad-assets/stories/concept-3/stories-1080x1920.png` | Exotic | Stories | McLaren side, cinema |
| `ad-assets/google/concept-3/google-display-1200x628.png` | Exotic | Google Display | OEM badge illustration |

**Image notes:**
- Higgsfield Seedream + Reve both returned 404 (not on account plan) — all generated via Soul model
- Soul model native output: **2048x1152 (16:9)** — each asset needs crop before upload
- Crop guidance in `ad-assets/generation-manifest.json`
- Concepts 2 (Huntington trust) and 4 (German OEM) NOT yet generated — Briefs 4-6, 10-12 pending

### 2. Campaign Brief + Copy Deck
`campaign-brief.md` — complete. Contains:
- 4 concept briefs with visual direction
- Full copy deck (all platforms, all headlines/descriptions, A/B variants)
- 12 image generation briefs
- Character counts verified for all platforms

### 3. Landing Pages — Next.js 16 App
Scaffolded and built at `ad-assets/landing-page/`. Build passes clean (0 errors).

**4 pages live:**
- `/ev-certified` — Rivian/Lucid, Roslyn: 516.627.3913
- `/exotic` — Aston Martin/McLaren, Roslyn: 516.627.3913
- `/huntington` — Family trust, Huntington: 631.270.0033
- `/german-oem` — Porsche/BMW/Audi/Mercedes, Roslyn: 516.627.3913

**Stack:** Next.js 16.2.5 · React 19 · Sanity (dep installed, not wired) · CSS custom properties (no Tailwind utilities)

**Design system:**
- Colors: OKLCH — deep navy `oklch(12% 0.04 252)`, champagne gold `oklch(74% 0.09 78)`, confidence red `oklch(38% 0.14 22)`
- Fonts: Gilda Display (headlines) + Jost (body)
- Reference aesthetic: Bentley · Rolls-Royce · Four Seasons per client design PDF
- Client design PDF: `[PSG Drive]/Clients E-H/Flower Hill Auto Body/Website/Proposal/Flower Hill - Design Themes.pdf`

**Form:** 4 fields (name, phone, vehicle, damage) → POSTs to `/api/estimate`. Logs to console. Sanity write NOT yet wired.

---

## Key Files & Locations

```
apps/ads/flower-hill/
├── campaign-brief.md             ← Full copy + image briefs
├── brand-profile.json            ← Brand DNA (colors, voice, certs, audience)
├── ADS-STRATEGY.md
├── BUDGET-PLAN.md
├── TRACKING-SETUP.md             ← Read before launch — GA4 + call tracking
├── ad-assets/
│   ├── generation-manifest.json  ← All 6 images + crop guidance + pending list
│   ├── meta/concept-1/           ← EV feed image
│   ├── meta/concept-3/           ← Exotic feed image
│   ├── stories/concept-1/        ← EV stories image
│   ├── stories/concept-3/        ← Exotic stories image
│   ├── google/concept-1/         ← EV google display
│   ├── google/concept-3/         ← Exotic google display
│   └── landing-page/             ← Next.js 16 app
│       ├── app/
│       │   ├── ev-certified/page.tsx
│       │   ├── exotic/page.tsx
│       │   ├── huntington/page.tsx
│       │   ├── german-oem/page.tsx
│       │   └── api/estimate/route.ts
│       ├── components/           ← LandingPage, Hero, TrustRail, ProofSection,
│       │                            EstimateForm, StickyPhoneCta, Footer, GoldRule, Badge
│       ├── lib/concepts.ts       ← All 4 page data definitions
│       └── public/
│           ├── fhab-logo.svg     ← Black SVG, rendered white via CSS filter
│           └── images/           ← hero-ev.png, hero-exotic.png + tall variants

[PSG Drive]/Clients E-H/Flower Hill Auto Body/
├── Logo/FHAB_BLACK_LOGO.svg      ← Source logo (black SVG)
└── Website/Proposal/             ← Design Themes PDF
```

---

## Decisions Made (Don't Re-Litigate)

| Decision | Rationale |
|----------|-----------|
| 4 separate pages, not shared template | Message match per ad concept — higher relevance score |
| Both call + form CTA | Covers high-intent callers + form-preferring browsers |
| Higgsfield AI images for hero | Generated and on-brand; client photography not available |
| Deep navy as primary background | Per client's Bentley/Four Seasons design PDF |
| Champagne gold for accents, red for CTA only | Client direction from design PDF |
| Gilda Display + Jost fonts | Rejected Playfair+Montserrat (overused); these match brief better |
| CSS custom properties, not Tailwind utilities | Custom luxury design system needs exact control |
| `/huntington` routes to 631.270.0033, others to 516.627.3913 | Location-based routing per campaign brief |
| Soul model for images | Seedream + Reve returned 404 on this Higgsfield account |

---

## What Needs to Happen Next

### Before Any Ad Spend

1. **Crop hero images** to platform dimensions — see `ad-assets/generation-manifest.json` for crop guidance per asset. Do not upload uncropped 2048x1152 to Meta.

2. **Confirm tracking before launch** — read `TRACKING-SETUP.md`. Needs:
   - GA4 estimate-form conversion event per concept slug
   - Call tracking numbers per location (attributable, not main line)
   - Meta Pixel + CAPI verified

3. **Deploy landing pages:**
   ```bash
   cd apps/ads/flower-hill/ad-assets/landing-page
   vercel
   ```
   Use preview URL for QA before pointing ads at it.

4. **Wire UTM passthrough on form** — capture `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` from URL on submit. Include in estimate record. Required to attribute leads back to specific ad.

### Next Sprint

5. **Generate Concepts 2 + 4 images** (Briefs 4-6, 10-12 in `campaign-brief.md`):
   - Concept 2 Brief 5 references `flower-hill-huntington-ny.png` — get exterior photo from client
   - Concept 4 needs Porsche/Audi/BMW hero

6. **Wire Sanity to estimate form** — `app/api/estimate/route.ts` currently logs only. Add `@sanity/client` write to `estimateRequest` document. Sanity project ID goes in `.env.local`.

7. **QA on real iOS Safari** — forms, sticky mobile CTA, hero image. DevTools is not enough.

8. **Run `/ads-landing` audit** on deployed URLs — will catch conversion friction, load time, and form UX gaps.

### Optional / Future

- Sanity Studio for client-editable headlines/copy
- OG image generation per page for social link previews
- A/B test headline variants
- Glen Cove concept if Huntington performs

---

## Open Questions

| Question | Owner |
|----------|-------|
| Huntington shop exterior photo for Concept 2 hero? | Client (FHAB) |
| Call tracking numbers per location? | PSG / Client |
| Sanity project ID — new or reuse existing? | Nick |
| Vercel team/domain — same org as tracys? | Nick |
| White logo variant from client, or CSS filter acceptable? | Design call |

---

## How to Resume

```bash
cd /Users/schoolcraft_mbpro/apps/ads/flower-hill/ad-assets/landing-page
npm run dev
# open http://localhost:3000 → redirects to /ev-certified
```

All 4 routes: `/ev-certified` `/exotic` `/huntington` `/german-oem`

Next session context: this file + `campaign-brief.md` + `generation-manifest.json`
