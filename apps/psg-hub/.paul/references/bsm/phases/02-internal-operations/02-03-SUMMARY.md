# Plan 02-03 Summary: Shop profile management and competitor landscape

**Status:** Complete
**Completed:** 2026-04-12

## What was built

Shop profile management is handled through two layers:

1. **Paperclip UI** (http://127.0.0.1:3100)
   - BSM company dashboard with 4 agents visible
   - Agent status, budgets, and activity tracking
   - Task management and approval workflows

2. **Sanity Studio** (cloud-hosted)
   - Shop documents with full profile data
   - Tracy's published as first shop
   - Content items linked to shops via references
   - Review workflow (draft > pending_review > approved > published)

3. **Filesystem** (shops/ directory)
   - Full profile JSON with auto-discovered data
   - Competitor list with BigQuery geodata (27 Lincoln NE shops)
   - SEO baseline from SEMrush
   - PSG survey data (11,146 responses)

## Competitor landscape

Tracy's competitor data sourced from BigQuery `psg_geo_data.us_body_shops`:
- 27 body shops in Lincoln NE market
- Tracy's South: 4.8 rating, Tracy's North: 4.7 rating
- Market average: 4.7
- Top threats: Miracle Workers (5.0), B Street (4.9), Morrow (4.9), Wenzl's (4.8)

## Notes

- Shop management currently split across Paperclip (agents), Sanity (content), and filesystem (full profile). Phase 3 will unify into the Next.js dashboard.
- Competitor landscape is viewable in the profile JSON. A dedicated UI view comes in Phase 3.
