# Deferred / Outstanding — psg-hub

Single running list of work consciously deferred (not lost). Near-term items first;
milestone-roadmapped items at the bottom. Update as items land or move.

_Last updated: 2026-06-18 (after 14-03b sentiment surface + the classify-cascade fix)._

## 🔐 Security — do not let rot

| Item | Origin | Notes |
|------|--------|-------|
| Rotate the chat-exposed GBP OAuth client secret (`GOOGLE_GBP_OAUTH_CLIENT_SECRET`) | 14-04 (pasted in chat) | Operator regenerates in the GCP console (n8n-workspace-apis client) → update the Vercel prod env → redeploy |
| Rotate the older chat-pasted keys | 12-04 / 12-05c | PAGESPEED, GTMETRIX, and the 12-04 Hetzner / AI-Gateway / SendGrid keys |

## v0.3.5 activation tail + follow-ups

| Item | Origin | Why deferred | Suggested home |
|------|--------|--------------|----------------|
| Systemic `locations` fleet backfill | 14-04 | `review_items` needs a NOT-NULL `public.locations` row onboarding never creates; only Wallace + Demo have one. Every other shop skips review ingest until backfilled | Fleet step before review/sentiment rollout (patch onboarding to create it, or a one-time backfill) |
| `maps_uri` / "View on Google" link activation | 14-03b SOURCE fix (8c8438c) | The Platform-badge link stays inert until a `gbp-presence-sync` run populates `maps_uri` | Auto on the monthly cron `0 4 1` (next ~2026-07-01), or a manual trigger |
| D3 — empirical 7-day GBP token pass-gate | 13-04 | Time-based; the Phase-10 revocation failure mode | Watch the gbp crons over a 7-day window |
| 14-02b — reply-publish live activation | 14-02 | Google bars automated/triggered replies without the end-client's prior express consent | Consent + per-shop authorization schema + approve-gate + UI publish button + add `/api/cron/gbp-reviews-reply` to `vercel.json`; **gated on legal sign-off** |
| 14-03c — low-confidence sentiment correction queue | 14-03b | The read surface shipped first; correction is a separate write concern | Queue UI + a correction write path + RLS write policy on `review_sentiment` + audit |

## Quality / scale ceilings (named, non-blocking)

| Item | Origin | Ceiling / upgrade path |
|------|--------|------------------------|
| Sentiment prompt-caching | 14-03 (`sentiment.ts`) | Gateway/Output.object has no `cache_control`; fleet-scale (842-shop) cost opt — AI SDK provider `cacheControl` or the responder.ts raw-SDK idiom |
| `getReviewSentimentSummary` JS aggregation → DB rollup | 14-03b | Per-shop fetch-cap + in-memory tally is correct for the pilot; a DB rpc/view is the fleet-scale upgrade |
| Classify-now interactive pacing | 14-03b fix (4779a16) | 150ms/call → a full 200-row run ~30s; if the interactive trigger feels slow, drop the per-call `limit` rather than removing the pacing |
| 842-shop performance batching; Peec AI + Local Falcon ingestion | v0.3 (12-05) | Post-v0.3 scale work |

## Time-bound watch

| Item | Origin | When |
|------|--------|------|
| 12-05 build-blind parser section-correctness verify | 12-05c | First UNMONITORED live run of the GA4-dims / PSI / GTMetrix parsers fires on the **2026-07-01** monthly crons (the scheduled agent checks send, not section correctness) — verify the Wallace July PDF's new sections before/right-after July 1 |

## Already roadmapped (tracked in ROADMAP.md / PROJECT.md)

| Item | Target |
|------|--------|
| Stripe INSERT→UPSERT (S3) + PII-at-rest retention | v0.4 Invoicing + Payments |
| MSO portfolio / cross-shop aggregate sentiment | post-pilot (per-shop only today) |
| Audit log | v1.5 Superadmin Matrix + Audit |
| Full 14-domain AEGIS sweep | v2.0 Convergence + Hardening |
