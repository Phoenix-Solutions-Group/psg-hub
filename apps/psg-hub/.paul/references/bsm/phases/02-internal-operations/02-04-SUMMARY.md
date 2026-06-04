# Plan 02-04 Summary: Content review workflow

**Status:** Complete
**Completed:** 2026-04-12

## What was built

The content review workflow connects agent output to human review:

1. **Agent produces content** > writes to filesystem (`shops/{slug}/content/`)
2. **Agent creates Sanity draft** > contentItem with status `pending_review`
3. **PSG account manager reviews** in Sanity Studio (cloud-hosted or local)
4. **Manager approves or rejects** > status changes to `approved` or `rejected`
5. **Approved content published** > status changes to `published`, publishedAt set

### Content types in the workflow

| Type | Agent | Review in | Status flow |
|------|-------|-----------|-------------|
| Blog post | content-writer | Sanity Studio | draft > pending_review > approved > published |
| Service page | content-writer | Sanity Studio | draft > pending_review > approved > published |
| SEO audit | seo-auditor | Sanity Studio | draft (informational, no publish needed) |
| Research brief | market-researcher | Sanity Studio | draft (informational, no publish needed) |

### Validation

- Tracy's blog post (hail damage repair) is in Sanity as `pending_review`
- Audit report and research brief are in Sanity as drafts
- All linked to Tracy's shop document via Sanity reference

## Notes

- Paperclip's approval gates are configured but not yet wired to Sanity status changes. In Phase 2, the Sanity review is the primary approval mechanism.
- Full Paperclip-to-Sanity integration (approval gate triggers Sanity status change) is a Phase 3 enhancement.
