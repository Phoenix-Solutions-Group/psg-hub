---
title: "README"
type: reference
source_path: "Logos & Graphics/PSG Logos/PSG Logo 3.0/Reference Material/Phoenix Solutions Group Design System (2)/ui_kits/marketing_site/README.md"
source_type: "md"
imported: "2026-05-27T12:34:14.451378"
tags:
  - psg-drive
  - md
---

# README

> **Non-canonical mirror.** This exported docs copy is retained for historical reference only. Use `packages/ui/psg-brand/` as the writable, current PSG brand source.

# Marketing Site UI Kit

A high-fidelity recreation of a typical Phoenix Solutions Group marketing-website view — built as a click-through prototype that demonstrates the brand's voice, layout vocabulary, and component patterns end-to-end.

## What's here

- **`index.html`** — the assembled site (Nav → Hero → Capabilities → Proof → Testimonial → CTA → Footer + Consult modal).
- **`styles.css`** — kit-local layout & component styles. Inherits tokens from `/colors_and_type.css`.
- **JSX components** (each global-exported via `window.X = X` so Babel script files can share):
  - `Nav.jsx` — sticky nav with hairline-on-scroll
  - `Hero.jsx` — editorial 7/5 split with stat aside
  - `CapabilityGrid.jsx` — 6-cell hairline grid
  - `Proof.jsx` — dark-band stat row
  - `Testimonial.jsx` — large pull-quote with attribution
  - `CtaBanner.jsx` — closing CTA on midnight
  - `Footer.jsx` — 4-column footer on deep midnight
  - `ConsultModal.jsx` — pop-up consultation form (interactive, with submit success state)

## Interactive demo
Click **Schedule consultation** anywhere (nav, hero, CTA banner) to open the consultation modal. Submit the form to see the success state.

## Notes
- Imagery is intentionally absent — see README "Caveats" for photo direction.
- Logo guidance in this docs mirror is historical. The current PSG brand package in `packages/ui/psg-brand/` uses official v3.0 logo assets and should be treated as the source for production work.
