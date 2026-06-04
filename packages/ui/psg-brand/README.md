# Phoenix Solutions Group — Design System

> 35 years of transformation. Heritage meets contemporary refinement.

This design system codifies the visual, verbal, and interaction language of **Phoenix Solutions Group (PSG)** — a marketing agency serving small-to-medium businesses, with deep specialization in the **collision repair** industry. Founded **1989**.

---

## Sources & inputs

| Source | Type | Path / Link | Status |
|---|---|---|---|
| `PSG Logo Variations_3.0_PSG 01.pdf` | Logo PDF (10 pages) | `uploads/PSG Logo Variations_3.0_PSG 01.pdf` | ⚠ Could not raster-extract logo art in this environment. SVG wordmark in `assets/` is a faithful **reconstruction** built from brand spec — replace with the official vector files when available. |
| Brand brief | Verbal spec | provided in chat | Captured in this README |
| Brand colors | Hex | `#1E3A52`, `#B8483E`, `#4A4257` | Implemented in `colors_and_type.css` |
| Typography | Names | Gotham (headings), Didact Gothic (body) | ✓ Both fully installed: full Gotham family in `fonts/Gotham-*.otf`, Didact Gothic in `fonts/DidactGothic-Regular.ttf`. |

---

## Brand essence

**Positioning.** PSG operates at the intersection of strategic insight and operational execution.
**Voice.** Understated luxury. Professional without being stiff. Confident without being arrogant. Modern without being trendy.
**Method.** Precision craft — clean structured layouts, ample whitespace, precise alignment, subtle depth, functional elegance.

**Four pillars:**
1. **Trust** — earned through consistency and follow-through.
2. **Innovation** — driven by practical solutions, not hype.
3. **Heritage** — 35 years of transformation expertise (est. 1989).
4. **Refinement** — attention to detail in every touchpoint.

**Audience.** Owner-operators and marketing leaders at SMBs, with a specialty in collision repair shops, MSOs (multi-shop operators), and adjacent automotive aftermarket.

---

## Content fundamentals

### Voice & tone
PSG writes like a senior consultant in a tailored sport coat — warm, precise, and quietly confident. Copy is **editorial**, never salesy. Sentences breathe. Adjectives earn their place.

| Dimension | PSG does | PSG does not |
|---|---|---|
| Person | Second person ("your shop", "your team") for value props; first-person plural ("we", "our") for capability statements | Avoids "I" — PSG is a team. Avoids royal "we" puffery. |
| Casing | **Title Case** for top-level page headers and product names. **Sentence case** for subheads, body copy, and UI labels. | No ALL-CAPS body copy. Uppercase reserved for short eyebrow labels with letter-spacing. |
| Punctuation | Em-dashes for asides — like this. Oxford comma. Periods at the end of every sentence, including bullets that read as sentences. | No exclamation points outside of error states. No emoji. |
| Numerals | Spell out one through nine; numerals 10+. Always numerals for years, $ amounts, percentages, and "35 years". | — |
| Contractions | Used sparingly in body copy ("we'll", "you're") to soften authority | Avoided in headlines and pull quotes. |
| Length | Short sentences interleaved with one longer. Paragraph max ~4 lines. | No wall-of-text. No five-clause headlines. |

### Vocabulary

**Lean into:** transformation, refinement, precision, partnership, craft, operational, practical, measured, established, fundamentals, results, alignment, follow-through.

**Avoid:** synergy, leverage, disrupt, hustle, crush it, supercharge, unlock (overused), ninja, rockstar, game-changing, world-class, cutting-edge, revolutionary, ! at end of sentences.

### Headline patterns

- **Statement of fact, then implication.** _"Marketing built around your bay schedule. Not the other way around."_
- **Number + craft noun.** _"35 years of transformation."_ _"Three pillars. One playbook."_
- **Industry-specific.** _"From estimate to five-star review."_ _"DRP performance, measured in cycle time."_

### Microcopy examples

- Button (primary CTA): **"Schedule a consultation"** — never "Get started now!" or "Click here"
- Form helper: _"We'll respond within one business day."_
- Empty state: _"Nothing here yet. Add your first campaign to begin."_
- Error: _"That email address didn't go through. Try again, or call us at (xxx) xxx-xxxx."_
- Footer tagline: _"Strategic insight. Operational execution. Since 1989."_

### Emoji & symbols

**No emoji.** Anywhere. Use brand-toned glyphs sparingly: em-dash (—), middot (·), arrows (→) where they earn the space.

---

## Visual foundations

### Color
The palette is **three signature hues + a warm-paper neutral system**.

| Token | Hex | Use |
|---|---|---|
| `--psg-midnight` | `#1E3A52` | Primary — headers, dark surfaces, body ink alt, deep CTA |
| `--psg-ember`    | `#B8483E` | Accent — single-use focal moments, links on hover, the Phoenix |
| `--psg-slate`    | `#4A4257` | Secondary — muted heading variants, secondary buttons, badges |
| `--psg-paper`    | `#FAF8F5` | Default page background — warm, off-white, never pure |
| `--psg-bone`     | `#F2EEE8` | Alt surface, panels, subtle cards |
| `--psg-stone`    | `#E4DED5` | Hairlines, dividers |
| `--psg-graphite` | `#2A2826` | Body ink |
| `--psg-mist`     | `#9A958E` | Secondary copy |

**Rules.**
- Ember is precious — use **once per view** in most cases.
- Backgrounds are paper or midnight; large slate fields are rare.
- Text on paper: graphite or ink. Text on midnight: paper or stone-95.
- No gradients except the rare protection-gradient on full-bleed photography (deep midnight at 0–40% alpha).

### Type
- **Display:** Gotham — Thin 100 / Light 300 for hero scale, Book 400 for h2, Medium 500 for h3–h6 (**Medium is the maximum weight** for any heading or display use, by brand rule), with **negative tracking** at large sizes.
- **Body:** Didact Gothic 400 — clean, humanist, generous x-height, set at 16px / 1.65 line-height.
- **Eyebrows:** Gotham Medium 12px, **uppercase**, `letter-spacing: 0.18em`, in ember.
- **Numerals:** Tabular figures preferred for any tabular data.

### Spacing
4-pt base grid. Section vertical rhythm = 96–128px on desktop; 48–64px mobile. Generous whitespace is **the signature** — never compress.

### Layout
- Three container widths: **narrow 768**, **base 1120**, **wide 1320**.
- 12-column grid, 24px gutter on desktop.
- Asymmetric editorial splits (5/7, 4/8) preferred over symmetric halves for marquee sections.
- Fixed nav (h=72px) with a subtle bottom hairline that appears on scroll.

### Backgrounds & imagery
- **Default:** flat paper. Photography enters as **deliberate full-bleed moments**, not pattern fill.
- **Imagery vibe:** warm, slightly desaturated, natural light, shallow depth of field. Auto-shop / cars / craftspeople-at-work imagery should feel documentary, not stock. Subtle warm grade (warm shadows, controlled highlights). Never cool / blue-shifted.
- **Patterns:** none, except an optional thin diagonal pinstripe overlay on midnight panels at <4% alpha.
- **Gradients:** only protection gradients on imagery (midnight 0% → midnight 60% bottom-up).

### Borders
- Hairlines are **1px**, color `--color-border` (warm stone). On dark surfaces, `rgba(255,255,255,0.12)`.
- Buttons & inputs: 1px border, default state. Focus ring is **2px ember** with 2px paper offset.

### Corner radii
- Default radius: **6px** (inputs, cards). Restrained.
- Hero cards: 10px max.
- **No pill shapes** except for tags/badges (`--radius-pill`) and avatar masks. Corner radii are mostly square — this is an editorial brand.

### Cards
A typical card:
```
background: surface (white) or bone
border: 1px solid stone
radius: 6px
shadow: subtle hairline + sm shadow on hover
padding: 24–40px
```
Cards do **not** stack heavy drop-shadows. Elevation is communicated with hairlines and tonal lift.

### Shadows
Five-step system, all warm-tinted toward midnight (not pure black).
- `--shadow-hairline` — 1px ring for surface separation
- `--shadow-sm` / `md` / `lg` / `xl` — increasingly soft, 16–64px blur, low alpha
- `--shadow-inset` — used inside form inputs

### Animation
- **Easing:** `cubic-bezier(0.22, 0.61, 0.36, 1)` (refined ease-out) is the workhorse.
- **Durations:** 140ms (fast / hover), 220ms (base / state changes), 420ms (slow / page transitions).
- **No bounce.** No spring overshoot. No confetti. The brand does not wiggle.
- Fades + 4–8px translate-up on scroll-in. That's it.

### Hover & press states
- **Hover:** primary buttons darken 15% (`--psg-midnight-15`); ember accent darkens to `--psg-ember-25`. Links pick up the ember underline color. Subtle 80–120ms transition.
- **Press:** translate-down 1px, no scale shrink.
- **Focus:** 2px ember ring, 2px offset.
- **Disabled:** 40% opacity, `cursor: not-allowed`.

### Transparency & blur
- **Blur:** reserved for sticky nav on scroll (`backdrop-filter: blur(12px)` over paper @ 80%) and for modal overlays (paper @ 60%).
- Glassmorphism, frosted cards, etc. — **no**.

### Iconography
See **Iconography** section below.

### Layout rules — fixed elements
- Top nav: 72px desktop, 64px mobile. Sticky, with hairline-on-scroll.
- Bottom-right utility (chat, contact): never floats over content; sits inside footer.
- Modal overlays: paper @ 60% alpha + 12px blur. Modal panel max-width 560px, paper background, hairline border.

---

## Iconography

**Icon system.** Lucide (https://lucide.dev) — chosen for its consistent **2px stroke**, **24×24 grid**, **rounded line caps**, and editorial restraint that matches PSG's understated aesthetic. Lucide is loaded via CDN in UI kits.

```html
<!-- via CDN -->
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="arrow-right"></i>
```

**Sizing.** 16px (inline body), 20px (button), 24px (default UI), 32px (feature icons).

**Stroke.** Always 2px. Never filled. Color inherits from `currentColor` — typically `--color-fg-1` or `--color-accent`.

**Pairings used in PSG materials:**
- `arrow-up-right` — outbound CTAs
- `chevron-right` — list affordances, breadcrumbs
- `circle-check` — success / capability bullets
- `phone`, `mail`, `map-pin` — contact
- `wrench`, `gauge`, `shield-check`, `line-chart`, `sparkles` (used sparingly), `target`, `users` — capability iconography

**Logo & marks.** Vector SVG only, in `assets/`:
- `psg-logo-primary.svg` — full lockup, primary use, paper background
- `psg-logo-reverse.svg` — knockout for midnight backgrounds
- `psg-logo-horizontal.svg` — horizontal compact lockup
- `psg-mark.svg` — just the phoenix/triangle mark; favicon, app tile, social avatar

⚠ **Substitution flag.** The current SVGs were reconstructed from the brand brief because the official PDF could not be rasterized in this environment. **Please attach the official PSG logo as PNG/SVG** so we can swap them in.

**Emoji.** Not used. Anywhere.

**Unicode glyphs.** Em-dash (—), middot (·), and arrow (→) are acceptable inline. No others.

---

## Index — what's where

```
/
├─ README.md                ← you are here
├─ SKILL.md                 ← agent-skill manifest (Claude Code compatible)
├─ colors_and_type.css      ← color tokens + type scale + semantic vars
├─ fonts/                   ← Gotham (full family) + Didact Gothic
├─ assets/
│  ├─ psg-logo-primary.svg
│  ├─ psg-logo-reverse.svg
│  ├─ psg-logo-horizontal.svg
│  └─ psg-mark.svg
├─ preview/                 ← Design System tab cards
│  ├─ type-display.html         (Gotham Thin → Medium specimen)
│  ├─ type-body.html            (Didact Gothic body + eyebrow)
│  ├─ colors-brand.html         (Midnight, Ember, Slate)
│  ├─ colors-neutrals.html      (Paper → Ink)
│  ├─ colors-semantic.html      (role tokens)
│  ├─ spacing-scale.html        (4-pt grid)
│  ├─ spacing-radii.html        (corner radii)
│  ├─ spacing-shadows.html      (5-step shadow scale)
│  ├─ components-buttons.html
│  ├─ components-inputs.html
│  ├─ components-cards.html
│  ├─ components-badges.html
│  ├─ brand-logos.html          (primary + reverse)
│  ├─ brand-marks.html          (mark + horizontal)
│  └─ brand-eyebrow.html        (voice example)
├─ ui_kits/
│  └─ marketing_site/       ← Marketing website UI kit
│     ├─ README.md
│     ├─ index.html         (interactive — open this)
│     ├─ styles.css
│     ├─ Nav.jsx
│     ├─ Hero.jsx
│     ├─ CapabilityGrid.jsx
│     ├─ Proof.jsx
│     ├─ Testimonial.jsx
│     ├─ CtaBanner.jsx
│     ├─ Footer.jsx
│     └─ ConsultModal.jsx
└─ uploads/                 ← original source files
```

**Brand rule applied throughout:** headings are Gotham, never heavier than Medium (500). Hero and large display set in Light (300) or Thin (100).

---

## Caveats & open items

1. **Logo art** — could not raster the provided PDF in-environment. SVGs in `assets/` are a faithful reconstruction. Need official vectors (Illustrator AI, EPS, or print-quality SVG/PNG).
2. **Gotham** — full family installed (`/fonts/Gotham-*.otf`). Brand rule: headings never heavier than Medium (500); hero/display use Light (300) or Thin (100).
3. **Photography** — no imagery provided. UI kits use deliberate placeholders. Need on-brand photo direction (collision-repair shop work, craftspeople, before/afters).
4. **Tone examples** — synthesized from the brief. Would benefit from real PSG marketing copy samples to refine.
