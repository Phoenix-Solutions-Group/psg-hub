---
name: phoenix-solutions-group-design
description: Use this skill to generate well-branded interfaces and assets for Phoenix Solutions Group (PSG) — a 35-year marketing agency specializing in collision repair. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping, slides, marketing pages, and production work.
user-invocable: true
---

# Phoenix Solutions Group — Design Skill

Read **README.md** in this skill first — it covers brand philosophy, voice, color, type, layout rules, and iconography in full. Explore the other available files before producing anything.

## Quick map

- **`README.md`** — full design language (philosophy, content fundamentals, visual foundations, iconography). The source of truth.
- **`colors_and_type.css`** — drop-in stylesheet. Defines all color tokens (`--psg-midnight`, `--psg-ember`, `--psg-slate`, neutrals, semantic), type scale, font families (Gotham + Didact Gothic, with `@font-face` to local files), spacing, radii, shadows, motion. Always link this first.
- **`fonts/`** — the full Gotham family (Thin → Ultra, regular + italic) and Didact Gothic. Used by `colors_and_type.css`.
- **`assets/`** — logo SVGs (`psg-logo-primary`, `psg-logo-reverse`, `psg-logo-horizontal`, `psg-mark`).
- **`preview/`** — small HTML cards demonstrating tokens (type, color, spacing, components, brand). Useful as visual reference.
- **`ui_kits/marketing_site/`** — full interactive marketing-site recreation (Nav, Hero, CapabilityGrid, Proof, Testimonial, CtaBanner, Footer, ConsultModal) with shared `styles.css`. Copy components from here when building marketing pages.

## Brand rules at a glance

- **Headings:** Gotham, never heavier than Medium (500). Hero/display use Light (300) or Thin (100).
- **Body:** Didact Gothic 400, 16px, line-height 1.65.
- **Eyebrows:** Gotham Medium, uppercase, 0.18em tracking, in `--psg-ember`.
- **Color anchors:** `#1E3A52` Midnight (primary), `#B8483E` Ember (accent — single focal moment per view), `#4A4257` Slate (secondary).
- **Backgrounds:** warm `--psg-paper` (#FAF8F5) or `--psg-midnight`. No gradients except occasional protection-gradient on full-bleed photos.
- **Voice:** understated luxury — confident, never salesy. No emoji. Em-dashes welcome. Sentence case for body and UI labels.
- **Motion:** ease-out `cubic-bezier(0.22, 0.61, 0.36, 1)`. Durations 140 / 220 / 420ms. No bounce, no spring overshoot.
- **Corners:** 6px default. Square-leaning. Pill shape only for tags/badges.

## How to work

When the user invokes this skill without further direction, ask what they want to build (slide deck, landing page, one-pager, internal tool mock, social asset, etc.) and what the audience is — collision-shop owners, MSO operators, internal team, etc. Then act as an expert designer:

- For visual artifacts (slides, mocks, throwaway prototypes): copy needed assets out of this folder, link `colors_and_type.css`, and produce static HTML files for the user to view. Reuse JSX components from `ui_kits/marketing_site/` where they fit.
- For production work: link `colors_and_type.css`, copy fonts and SVG logos into the project, and follow the brand rules in `README.md`.

If the user asks for "more like" something, look at `ui_kits/marketing_site/index.html` and the `preview/` cards as the canonical examples. Mirror their layout vocabulary: editorial 5/7 splits, hairline grids, eyebrow-then-headline sections, generous whitespace, single ember accents.

## Caveats to flag if relevant

- The PSG logo SVGs in `assets/` are a **reconstruction** built from the brand brief. If the user has an official vector logo, swap them in.
- No on-brand photography is included. Imagery should be warm, documentary, slightly desaturated — collision-shop work, craftspeople, real cars in real bays. Never stock-cool.
