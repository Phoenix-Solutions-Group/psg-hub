# Deferred / Outstanding — psg-hub

Single running list of work consciously deferred (not lost). Near-term items first;
milestone-roadmapped items at the bottom. Update as items land or move.

_Last updated: 2026-06-18 (12-05c live parser validation: GA4-dims + PSI-lab VALIDATED on prod; Wallace PSI 400 was transient + resolved; PSI error-body diagnosability fix shipped `c104227`)._

## 🔐 Security — do not let rot

| Item | Origin | Notes |
|------|--------|-------|
| Rotate the chat-exposed GBP OAuth client secret (`GOOGLE_GBP_OAUTH_CLIENT_SECRET`) | 14-04 (pasted in chat) | Operator regenerates in the GCP console (n8n-workspace-apis client) → update the Vercel prod env → redeploy |
| Rotate the older chat-pasted keys | 12-04 / 12-05c | PAGESPEED, GTMETRIX, and the 12-04 Hetzner / AI-Gateway / SendGrid keys |
| `CRON_SECRET` rotated on prod 2026-06-18 | 12-05c validation | Was write-only/unrecoverable; rotated to a known value to run the manual cron-POSTs. New value in `~/.psg-cron-secret` (600). Vercel's 10 scheduled crons auto-use it (Vercel injects the header). Not chat-exposed. Recoverable now (improvement), but treat the local file as a secret |

## v0.3.5 activation tail + follow-ups

| Item | Origin | Why deferred | Suggested home |
|------|--------|--------------|----------------|
| Systemic `locations` fleet backfill | 14-04 | `review_items` needs a NOT-NULL `public.locations` row onboarding never creates; only Wallace + Demo have one. Every other shop skips review ingest until backfilled | Fleet step before review/sentiment rollout (patch onboarding to create it, or a one-time backfill) |
| `maps_uri` / "View on Google" link activation | 14-03b SOURCE fix (8c8438c) | The Platform-badge link stays inert until a `gbp-presence-sync` run populates `maps_uri` | Auto on the monthly cron `0 4 1` (next ~2026-07-01), or a manual trigger |
| D3 — empirical 7-day GBP token pass-gate | 13-04 | Time-based; the Phase-10 revocation failure mode | Watch the gbp crons over a 7-day window |
| 14-02b — reply-publish live activation | 14-02 | Google bars automated/triggered replies without the end-client's prior express consent | Consent + per-shop authorization schema + approve-gate + UI publish button + add `/api/cron/gbp-reviews-reply` to `vercel.json`; **gated on legal sign-off** |
| 14-03c — low-confidence sentiment correction queue | 14-03b | The read surface shipped first; correction is a separate write concern | Queue UI + a correction write path + RLS write policy on `review_sentiment` + audit |
| Make a transient PSI 400 retryable | 12-05c live validation 2026-06-18 | Wallace's PSI 400 was **TRANSIENT, not a block** — it failed run 1 (synced:4/failed:1) then SUCCEEDED on a re-run ~30min later (synced:5/failed:0, perf_score 84). Wallace now has its 2026-05 `performance` row; the WAF/crawler-block hypothesis is DISPROVEN. GAP: `isRetryablePerfError` treats ALL 4xx (incl. 400) as non-retryable, so a transient Lighthouse 400 (`ERRORED_DOCUMENT_REQUEST`) fails a shop for the whole month with no retry | Once the deployed diagnosability fix captures a real 400 body, branch `isRetryablePerfError` to retry a 400 whose body is a Lighthouse/document-request error while keeping a genuine bad-request 400 (e.g. invalid key) non-retryable |
| ✅ PSI fetcher error-body capture (diagnosability) — **DONE 2026-06-18** | 12-05c | Was: `defaultHttpGet` threw `PSI HTTP ${status}` without the PSI `error` body | DONE: now throws `PSI HTTP ${status}: ${body}` (whitespace-collapsed, 500-cap; no api key in body). Commit `c104227`, deployed `dpl psg-dw0h14jb2`, vitest 748 (+1 real-fetch-path test). Unblocks the retryability branch above |
| GTMetrix parser unexercised on prod | 12-05c | `GTMETRIX_API_KEY` + `GTMETRIX_SHOP_IDS` ARE configured, but every inspected `performance` row (2× Flower Hill + Wallace) has `gtmetrix:null` → none of those is the scoped pilot shop. The GTMetrix parse path has no live prod coverage yet | Identify the `GTMETRIX_SHOP_IDS` shop and inspect its row's `gtmetrix` (a `select sh.name, s.metrics->'gtmetrix' ... where source='performance'` settles it), else it rides the 2026-07-01 cron |

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
| 12-05 parser section-correctness | 12-05c | **PARTLY RESOLVED 2026-06-18 (live prod run, manual cron-POST, month=2026-05):** GA4-dims parser ✅ VALIDATED (Wallace row — all 4 dimension arrays + `(other)` reconciliation + `averageSessionDuration`, shape matches `Ga4DimensionsMetrics`); PSI-lab parser ✅ VALIDATED on 3 shops incl. Wallace (full `PsiResult`; Wallace perf_score 84). STILL UNEXERCISED on prod: the **GTMetrix** parser (no inspected row carries it — see the GTMetrix row above) and the **CrUX `psi.field`** non-null branch — `field:null` even for Wallace (745 sessions), confirming collision-shop origins sit below the CrUX popularity threshold, so this branch is expected-null fleet-wide (covered only by unit tests). What still rides the **2026-07-01** cron: the Wallace **PDF** render + GTMetrix. Wallace's perf block now populates (the 400 was transient) |

## Already roadmapped (tracked in ROADMAP.md / PROJECT.md)

| Item | Target |
|------|--------|
| Stripe INSERT→UPSERT (S3) + PII-at-rest retention | v0.4 Invoicing + Payments |
| MSO portfolio / cross-shop aggregate sentiment | post-pilot (per-shop only today) |
| Audit log | v1.5 Superadmin Matrix + Audit |
| Full 14-domain AEGIS sweep | v2.0 Convergence + Hardening |
