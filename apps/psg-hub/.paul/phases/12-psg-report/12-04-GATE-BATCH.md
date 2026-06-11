# Phase 12 / 12-04 — Operator Gate Batch (report pipeline prod activation)

One ordered runbook to activate the PSG monthly report on prod. Everything build-local
is done (tsc 0 · eslint 0 · vitest 532; ZERO prod contact to here). These stages touch
prod / a new host and need the operator (secrets + a Hetzner deploy are outside
autonomous scope). Same build-local -> operator-gate pattern as Phases 9, 10, 11.

**Scope note:** this activates the live-data BASE report (12-01..12-04). The 12-05
GA4-dimensional + real-performance expansion (CrUX/PageSpeed/GTMetrix) follows in this
phase and layers on the SAME infra (no new worker) — so the final `feature/12-psg-report`
-> main merge can wait for 12-05 close (Stage G is conditional).

---

## Stage A — Apply the migration

`supabase/migrations/20260610000000_monthly_reports.sql` to `gylkkzmcmbdftxieyabw`,
under `PROTOCOL-migration-safety.md` (advisor baseline + diff).

- Re-capture the advisor baseline, apply, re-diff. Expect: new `public.monthly_reports`
  table + its member-SELECT RLS, + the `storage.objects` SELECT policy for the
  `monthly-reports` bucket. No unexpected ERROR/WARN.
- CONFIRM the `((storage.foldername(name))[1])::uuid` cast behaves on a real key
  (`{shop_id}/{period}.pdf`) — service-role writes only ever produce valid uuid first
  segments, but verify the policy does not throw on the real object layout.

_Verify (Claude can assist):_ advisor diff clean; `monthly_reports` present; policy listed.

## Stage B — Create the private bucket

Create Supabase Storage bucket **`monthly-reports`**, **private** (public = off). The
bucket SELECT RLS from Stage A gates customer downloads; uploads are service-role.

_Verify:_ bucket exists, private.

## Stage C — Deploy the Chromium worker (Hetzner)

`apps/psg-hub/workers/report-renderer/` — build the image and run on a host PSG controls.

```
cd apps/psg-hub/workers/report-renderer
docker build -t psg-report-renderer .
# run on Hetzner with RENDER_TOKEN set (generate a strong token; reuse it in Stage D):
docker run -d --name psg-report-renderer -p 8080:8080 -e RENDER_TOKEN='<STRONG_TOKEN>' psg-report-renderer
```

- Note the worker's reachable URL (e.g. `https://render.<host>/` or an IP:port behind TLS).
- Smoke the worker health: `GET <worker>/health` -> `ok`.

_Verify:_ `/health` returns 200; container up.

## Stage D — Set the app secrets + SendGrid template

On the `psg-hub` Vercel project (and local `.env` for any manual trigger):

| Secret | Value |
|--------|-------|
| `REPORT_RENDER_URL` | the Stage-C worker URL (the POST endpoint) |
| `RENDER_TOKEN` | the SAME token set on the worker in Stage C |
| `REPORT_EMAIL_TEMPLATE_ID` | the SendGrid dynamic template id (below) |
| `AI_GATEWAY_API_KEY` | the Vercel AI Gateway key (the 12-02 live-Gateway secret) |

- Provision the SendGrid **dynamic template** with handles: `{{shopName}}`,
  `{{monthLabel}}`, `{{reportUrl}}` (the membership-gated download link). Use the id
  for `REPORT_EMAIL_TEMPLATE_ID`.
- `CRON_SECRET` already exists (the daily syncs use it). `NEXT_PUBLIC_APP_URL` already
  set (`https://hub.psgweb.me`).

_Verify:_ `vercel env ls` shows all four; SendGrid template published.

## Stage E — Deploy

`vercel --prod` from the repo root (the established deploy path; git-on-main is OFF).

_Verify:_ the new function `ƒ /api/cron/monthly-report` is live; `vercel.json` shows 5 crons.

## Stage F — Live smoke (one shop, end-to-end)

Trigger the cron manually for the pilot shop (Wallace) — it is idempotent, so a re-run
is safe:

```
curl -X POST https://hub.psgweb.me/api/cron/monthly-report \
  -H "Authorization: Bearer $CRON_SECRET"
```

Confirm the loop closed on a REAL DELIVERED REPORT (not a cron-200):
1. A real PDF object at `monthly-reports/{wallace_shop_id}/{period}.pdf`.
2. A `monthly_reports` row for (shop, period) with `storage_path` + `emailed_at` set.
3. The link-email received at the owner address; it renders shopName / monthLabel / link.
4. The link downloads the PDF through the membership gate (logged-in owner = 200; a
   non-member / logged-out = 403 / 401; never a raw signed URL).

If `held` (no linked sources for the month) or `failed` for the pilot, capture the
counts JSON and we diagnose before declaring activation.

## Stage G — Merge (conditional)

Because 12-05 follows in this phase, KEEP `feature/12-psg-report` open and defer the
final phase merge to 12-05 close. (Only merge to main here if you decide to stop after
12-04.)

---

## Activation-pending fallback

If a blocker prevents activation (e.g. Hetzner provisioning lead time, SendGrid template
review), close 12-04 **code-complete with activation-pending recorded honestly** (the
Phase-9 precedent) — not as a defect. The base pipeline is built + green; activation
resumes when the blocker clears, and can fold into the 12-05 gate batch.
