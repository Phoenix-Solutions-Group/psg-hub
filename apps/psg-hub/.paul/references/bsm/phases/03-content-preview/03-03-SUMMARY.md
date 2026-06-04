# Plan 03-03 Summary: Styled HTML preview template generator

**Status:** Complete
**Completed:** 2026-04-12

## What was built

1. **Preview generator** at `preview/generate-preview.js`
   - Takes shop slug + content filename as input
   - Reads shop profile JSON for business data (locations, phone, certs)
   - Reads markdown content file with frontmatter
   - Converts markdown to HTML
   - Wraps in client-styled template (header, footer, nav matching their site)
   - Outputs standalone HTML file to `preview/output/`
   - All user-supplied data is HTML-escaped to prevent XSS

2. **Generated preview for Tracy's hail damage blog post**
   - Output: `preview/output/tracys-collision-center--blog-hail-damage-repair.html`
   - Styled with Tracy's colors (maroon #79111D, yellow #FFCC01)
   - Tracy's fonts (Glacial Indifference, Open Sans)
   - Header with nav and call CTA
   - Footer with both locations
   - Preview banner with Approve / Request Changes buttons
   - Meta bar showing content type, target keyword, status

## Usage

```bash
node preview/generate-preview.js tracys-collision-center blog-hail-damage-repair.md
```

Opens as a local file in the browser. Can be shared with clients via any file sharing method, or hosted on a preview URL for remote access.
