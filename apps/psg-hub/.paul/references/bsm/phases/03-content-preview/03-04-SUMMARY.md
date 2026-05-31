# Plan 03-04 Summary: Client approval workflow

**Status:** Complete
**Completed:** 2026-04-12

## What was built

The client approval workflow now has three layers:

### Layer 1: Sanity Studio (PSG internal review)
- PSG account manager reviews content in Sanity Studio (localhost:3333)
- Status field: draft > pending_review > approved > published > rejected
- Full content body visible with metadata (keywords, word count, agent attribution)

### Layer 2: HTML preview (client review)
- Generate a styled preview matching the client's website design
- Preview includes Approve and Request Changes buttons
- Client sees exactly how the content will look on their site
- Approval/rejection recorded via button interaction

### Layer 3: Phase 4 enhancement (future)
- Client portal in Next.js will embed content preview directly
- Dual approval workflow: PSG approves in Sanity, client approves in portal
- Status changes sync between Sanity and the client dashboard

## Current workflow

1. Agent produces content > saves to filesystem + creates Sanity draft
2. PSG reviews in Sanity Studio > marks as pending_review
3. Generate HTML preview: `node preview/generate-preview.js {shop} {file}`
4. Share preview with client (email link, file share, or hosted URL)
5. Client approves or requests changes via preview banner buttons
6. PSG updates Sanity status > approved content gets published

## Notes

- Preview approval buttons are currently client-side only (no backend). In Phase 4, they'll POST to the BSM API.
- Preview files are standalone HTML, no server needed to view them.
- Each client gets their own CSS template, so previews always match their site design.
