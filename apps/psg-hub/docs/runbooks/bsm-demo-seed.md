# Runbook — Seed the runnable BSM demo environment

**Issue:** PSG-335 (parent PSG-334). **Demo script:** `apps/psg-hub/docs/demos/bsm-board-demo-script.md`.
**Seed file:** `apps/psg-hub/supabase/seeds/bsm_demo.sql` (idempotent, teardownable).
**Target project:** shared Supabase `gylkkzmcmbdftxieyabw` (localreach).

The goal: a presenter can click every step of §2 (super admin) and §3 (shop) with **no empty
states and no live mail sent**. The demo tenant is one pilot shop, **Riverside Collision**, around
one customer (**Maria Alvarez / 2021 Honda Civic**).

---

## Status as of this runbook

`bsm_demo.sql` sections 1–7 have been **applied to the shared DB and verified** by Ravi (PSG-335):
Riverside shop + primary location; 4 reviews with mixed sentiment (1 actionable 1-star);
1 owner-voice service-recovery draft reply; 2 content items; 1 organic (Semrush) analytics
snapshot; Maria Alvarez closed RO (`RO-77001`) on a 2021 Civic; 2 CSI surveys (one high → thank-you
eligible, one low → service-recovery eligible); 3 CCC connections (pending / connected / error);
`thank_you` (released) + `service_recovery` (approved) template approvals at the **current
origin/main content hashes** (`a419851a…` / `d1846f2d…`, commit `cd4c500`).

The two **fenced sections** at the end of the seed file are NOT yet applied — they have operator
prerequisites (below).

---

## Agent-doable vs operator-gated (pre-flight matrix)

| §1 item | Status | Owner |
|---|---|---|
| 1. Demo tenant (shop, RO, thank-you + service-recovery customers, reviews) | ✅ Seeded & verified | Ravi |
| 2. `thank_you` + `service_recovery` approved in the gate | ✅ Seeded (released / approved) at current hash | Ravi |
| 4. CCC connection in each state (connected / pending / error) | ✅ Seeded & verified | Ravi |
| 6. Reviews + sentiment on the dashboard | ✅ Seeded (mixed, 1 actionable) | Ravi |
| 3. **Lob in TEST mode** (`LOB_API_KEY=test_*`) | ⛔ Operator secret | **Nick** |
| 5. **Shop-scoped login** (auth.users + password) | ⛔ Agents can't create auth users | **Nick** |
| — **`db push` 2 pending migrations** (approval_queue, review_solicitation) | ⛔ Shared-prod DDL | **Nick** |
| — **Proof PDF render env** (`MAIL_RENDER_URL`, `RENDER_TOKEN`) for §2 S4 | ⛔ Operator env | **Nick** (confirm) |

> Superadmin login already exists: `nick@` and `tina@` are `psg_superadmin`. §1 item 5's *superadmin*
> half is done; only the *shop-scoped* login is outstanding.

---

## Operator steps to finish the environment

1. **Apply the two pending migrations** (back the §3 approvals inbox — C1/C2/C4). They are merged to
   `main` but not in the shared DB (DB is at `20260624130000`):
   - `apps/psg-hub/supabase/migrations/20260624120000_approval_queue.sql`
   - `apps/psg-hub/supabase/migrations/20260624140000_review_solicitation.sql`
   Apply via `supabase db push`, or apply those two migration bodies via the Supabase MCP/SQL editor.
   Then **uncomment + run FENCED SECTION A** of `bsm_demo.sql` (the two `approval_queue` rows).

2. **Set Lob to TEST mode.** Set `LOB_API_KEY` to a `test_*` key in the demo deployment's env.
   The guard (`src/lib/production/seed-test.ts`) **rejects `live_*` keys with 403** — verify by
   clicking "Seed test (Lob test mode)" on `/ops/production/templates`; a live key returns the
   refusal message, a test key returns `mode: lob_test`. **No real mail is ever sent.**

3. **Create the shop-scoped login.** Create an auth.users login (email + password) for the demo —
   e.g. `riverside.demo@phoenixsolutionsgroup.net`. Then attach it to the shop: uncomment
   **FENCED SECTION B** of `bsm_demo.sql`, paste the new user's UUID, and run it (inserts the
   `shop_users` owner membership for Riverside). Without this membership, RLS hides all the seeded
   shop-side rows and `/dashboard/*` shows empty states.

4. **Confirm proof-render env.** `/ops/production/templates` → "View proof" renders HTML inline
   (works without extra env). The downloadable **PDF** proof (§2 S4) needs `MAIL_RENDER_URL` +
   `RENDER_TOKEN` set. Confirm they're present in the demo env, or present the inline HTML proof.

---

## Apply / re-apply the seed

```
# from apps/psg-hub, against the demo project (service role):
psql "$DATABASE_URL" -f supabase/seeds/bsm_demo.sql
# or paste the file body into the Supabase SQL editor.
```
The file is idempotent (fixed UUIDs + ON CONFLICT) — safe to re-run after the migrations/login land.

## Verification checklist (maps to the demo script)

**§2 Super admin** (login: `nick@` / `tina@`)
- S2 `/ops/production` — print queue renders.
- S3 `/ops/production/templates` — `thank_you` shows **Released**, `service_recovery` shows
  **Approved**, both at the live hash (no "stale" badge). Missing-token report shows.
- S4 "View proof" → `thank_you` renders (PDF needs render env per step 4 above).
- S5 `service_recovery` → **Approve → Release** is clickable live.
- S6 `/ops/admin/integrations/ccc` — **Pending (1) / Connected (1) / Errors (1)** all non-empty
  (`BSMDEMO-*`).
- S7 `/ops/admin/audit` — append-only log renders.

**§3 Shop** (login: the new Riverside shop user, after step 3)
- C1 `/dashboard/approvals` — 2 pending items (review request + service-recovery) *[after step 1]*.
- C3 `/dashboard/reviews` — 4 reviews, sentiment tags, the 1-star flagged actionable.
- C4 `/dashboard/approvals` — the service-recovery draft *[after step 1]*.
- C5 `/dashboard/content` — 2 content items (approved / published).
- C6 `/dashboard/analytics` — **Organic (Semrush)** populated. Paid/GA4/GSC/GBP cards show
  "not linked" (live-API only) — present organic, describe the rest per §4 honesty appendix.

## Teardown

The bottom of `bsm_demo.sql` has a commented teardown block that deletes every demo row
(`BSMDEMO-*` CCC, the Riverside shop + cascade, the demo client, Maria's RO, the CSI surveys, and
the seed template approvals). Run it to clean up after the demo.
