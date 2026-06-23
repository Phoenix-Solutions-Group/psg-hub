# Operator runbook — CCC Phase-3 connections approval queue (live browser smoke)

**Route:** `/ops/admin/integrations/ccc` · **Issue:** [PSG-303] (downstream of [PSG-267]; QA [PSG-298] PASSED on the merged tree)
**Audience:** operator (env setup + click-through) → hand results/screenshots back to QA (Tess).

This is the **post-deploy live** verification of the superadmin CCC connections queue. The functional /
integration / UI-render ACs are already covered by Vitest on the merged tree (PSG-298 PASS); this runbook
only adds the things a sandbox cannot prove: a real DB with the Phase-3 migration applied + a real
`psg_superadmin` browser session.

**Deploy-safe note:** if the migration is *not* applied, the page does not 500 — it renders a notice
*"The CCC connection store is unavailable — the Phase-3 migration may not be applied in this environment."*
So this runbook is **not a merge blocker**; it is the live click-through after the migration is applied.

All facts below were verified by QA against the merged source (2026-06-23):
- route + superadmin gate: `src/app/ops/admin/integrations/ccc/page.tsx`
- state machine: `src/lib/ccc/approval-queue.ts`
- routes: `src/app/api/ops/admin/integrations/ccc/[id]/{approve,decline,revoke}/route.ts`
- queue UI: `src/components/ops/ccc-approval-queue.tsx`
- migration: `supabase/migrations/20260624130000_ccc_phase3_connection_status.sql`

---

## 1. Setup (operator)

### 1a. Apply the migrations (operator gate — PROTOCOL-migration-safety)

> ⚠️ **Verified 2026-06-23: `ccc_accounts` does not exist in prod yet**, so you must apply **both** the Phase 1A
> foundation (`20260623190000`) *and* Phase 3 (`20260624130000`), in that order — not just Phase 3 as originally
> worded. **And do NOT use `supabase db push` / `migration repair --reverted` / `db pull` here** — see **§4a** for
> the verified state, why those CLI commands are unsafe on this shared DB, and the correct dashboard-SQL apply path.

### 1b. Seed `ccc_accounts` rows spanning statuses

Seed via the service role (the queue reads/writes cross-shop via the service client; RLS bypass mirrors
`/ops/intel`). Use real `shops.id` UUIDs for the linked rows. Minimum set to exercise every AC:

| # | `connection_status` | `shop_id`        | Purpose                                  |
|---|---------------------|------------------|------------------------------------------|
| 1 | `pending_review`    | a real shop UUID | AC3 Approve→Connected; counts toward Pending |
| 2 | `pending_review`    | `null`           | AC4 orphan: Approve disabled until linked |
| 3 | `connected`         | a real shop UUID | AC3 Revoke→Not connected; AC5 double-decision |
| 4 | `error`             | a real shop UUID | AC2 Errors tab; revocable                 |
| 5 | `declined`          | a real shop UUID | AC2 counts (All only); shows reason if set |

Each row also needs `ccc_account_id` (display id) and optionally `facility_id`, `enabled_at`.

### 1c. Log in as a `psg_superadmin`

Use a superadmin account. (A non-superadmin session is also needed once, for AC1.)

---

## 2. Walk-through (spec §4 B)

Capture a screenshot at each ✅ checkpoint. Fill **Actual** + **Pass/Fail** in §3.

### AC1 — gate
- **Non-superadmin** loads `/ops/admin/integrations/ccc` → restricted notice *"This area is restricted to
  superadmins."*; the nav entry to this route is hidden.
- **Superadmin** loads it → the queue renders (header "CCC Secure Share — Connections").
- *Expected:* gate is server-side (`getOpsAccess(user.id).role !== "psg_superadmin"`); unauthenticated →
  redirect to `/login`.

### AC2 — tabs / counts
- Four tabs render with live counts in parentheses: **Pending (n) · Connected (n) · Errors (n) · All (n)**.
- With the seed above: Pending = 2, Connected = 1, Errors = 1, All = 5. (`declined` and `not_connected`
  appear **only** under All — there is no Declined tab.)
- Switching tabs filters the list to matching rows.

### AC3 — transitions (+ audit)
For each, after the action confirm a row was appended to **`access_audit`** with the listed action, the
acting superadmin as actor, and the target `shop_id`:

| Action | From → To | Audit `action` | UI affordance |
|--------|-----------|----------------|---------------|
| Approve (row #1, already linked) | `pending_review` → `connected` | `ccc.connection.approve` | green **"Approve connection"** |
| Decline (row #1 if re-seeded, or another pending) | `pending_review` → `declined` | `ccc.connection.decline` | red **"Decline…"** → reason box |
| Revoke (row #3 or #4) | `connected`/`error` → `not_connected` | `ccc.connection.revoke` | red-outline **"Revoke"** |

- **Decline reason is required and hard-capped at 280 chars** (`MAX_DECLINE_REASON`; the textarea slices
  input at 280, and the route rejects empty/over-limit). After decline, the row shows *"Declined: <reason>"*.
- After Approve, the badge flips to the Connected presentation; the row now offers only **Revoke**.

### AC4 — no orphan
- For the unmatched pending row (#2, `shop_id = null`): the **"Approve connection"** button is **disabled**
  (hover title *"Link this connection to a shop first"*) and a **"Link to shop:"** dropdown is shown.
- Pick a shop in the dropdown → Approve becomes enabled → click Approve → the row **links then connects in
  one action** (single POST with `{ shopId }`). Confirm the `access_audit` row's target shop = the picked shop.

> ⚠️ **Seeding caveat (real finding):** `ccc_accounts.shop_id` is declared **`NOT NULL`** (Phase 1A migration
> `20260623190000`), and **no later migration relaxes it**. So the orphan row (`shop_id = null`) **cannot be
> inserted** — the seed will fail with a not-null violation. The whole unmatched/link-to-shop UI + `approveCccConnection`'s
> `if (!shopId) throw` path therefore can't be reached against the current schema. **AC4 is already proven by
> unit tests on the merged tree (PSG-298 PASS)** — recommend **skipping AC4 in the live smoke** rather than
> relaxing a column on the shared prod DB just for a click-through. Tracked as a follow-up for the PSG-267 owner
> (schema gap: either make `shop_id` nullable, or document the unmatched UI as not-yet-reachable). See §5.

### AC5 — double-decision (409)
- A second decision on an already-resolved row is rejected by the state machine → route returns **409**, and
  the error is surfaced inline in the row (red text under the actions).
- **UI nuance:** once a row is `connected`, the Approve button is gone (only Revoke shows), so to reproduce
  the 409 in the browser you need a **stale view** — e.g. open the queue in two tabs, Approve row #3 in tab A,
  then click Approve on the same still-"pending" row in tab B (or replay the approve POST). Expect the row to
  show *cannot approve a connection in state "connected"* and **no** second audit row / no state change.

---

## 3. Evidence capture (fill in and hand back to QA / Tess)

| AC  | Step | Expected | Actual | Pass/Fail | Screenshot |
|-----|------|----------|--------|-----------|------------|
| AC1 | non-superadmin load | restricted notice + nav hidden | | | |
| AC1 | superadmin load | queue renders | | | |
| AC2 | tab counts | Pending 2 / Connected 1 / Errors 1 / All 5 | | | |
| AC2 | tab filter | each tab shows only matching rows | | | |
| AC3 | approve linked | → Connected + `ccc.connection.approve` audit | | | |
| AC3 | decline (reason) | → Declined, reason shown, audit | | | |
| AC3 | decline empty/>280 | rejected (no transition) | | | |
| AC3 | revoke | → Not connected + `ccc.connection.revoke` audit | | | |
| AC4 | orphan approve disabled | disabled until shop picked | | | |
| AC4 | link + approve | links then connects, audit target = picked shop | | | |
| AC5 | re-approve connected | 409 surfaced in row, no 2nd audit | | | |

**Hand back to:** QA — [Tess](/PSG/agents/tess) on PSG-303. Re-loop if anything diverges from Expected.

---

## 4. Concrete operator how-to (exact commands)

> **There is NO separate test/pilot DB.** Per `.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md`,
> all psg-hub DDL lands on the **shared prod** Supabase project `gylkkzmcmbdftxieyabw` ("localreach",
> ~314k PII rows / 142 shops). So "apply in test/pilot" = apply to that shared project, carefully. The
> migration itself is additive + idempotent (safe). The **seed rows are synthetic test data written to a
> prod table** — tag them and delete them after (§4e). Prefer a low-traffic window.

### 4a. Apply the migrations  (operator gate)  — **DO NOT use `supabase db push` here**

**Verified prod state (2026-06-23, read-only `execute_sql` on `gylkkzmcmbdftxieyabw`):**
- `public.ccc_accounts` **does not exist** (0 `ccc_*` tables). So **both** CCC migrations are unapplied:
  - `20260623190000_ccc_secure_share_foundation.sql` — **Phase 1A**, *creates* `ccc_accounts` + `ccc_api_call_log` + the `manage_ccc_integration` capability + RLS. **Not recorded applied.**
  - `20260624130000_ccc_phase3_connection_status.sql` — **Phase 3**, *adds* `connection_status` etc. **Has a phantom "applied" ledger row** even though its target table never existed (the remote `schema_migrations` table is unreliable here).
- Everything else the smoke needs already exists: `access_audit`, `app_user_roles` (already has **2** `psg_superadmin`s), `shops`, `public.user_shop_ids()`, `private.current_user_has_fn`. So Phase 1A's RLS policy will create cleanly.

> ⛔ **Do NOT run `supabase db push`, `supabase migration repair --status reverted …`, or `supabase db pull`.**
> The CLI's own error suggests these, but they are **wrong on this shared DB**: the ~30 "remote-only" versions
> it complains about (`20260610145915`, `20260611162332`, … `20260623095228`) are **sibling apps'** migrations
> (psg-advantage-portal / market-intelligence) that legitimately live on the same project and are **not** in this
> repo (PSG-252 / PSG-269 cross-app mirror). `repair --reverted` would mark those real migrations reverted, and
> `db pull` would suck their schema into our repo — both corrupt the shared ledger. `db push` would also skip
> Phase 3 (phantom row) while batch-applying a large backlog of local-only versions to prod. Avoid all of it.

**Apply path — dashboard SQL editor (no CLI auth needed):** open the Supabase dashboard → SQL editor for project
`gylkkzmcmbdftxieyabw`, and run the two migration files **in order**. Both are fully idempotent
(`create table if not exists` / `add column if not exists`), so they are safe even if partially present:
1. paste the contents of `apps/psg-hub/supabase/migrations/20260623190000_ccc_secure_share_foundation.sql`, run;
2. paste the contents of `apps/psg-hub/supabase/migrations/20260624130000_ccc_phase3_connection_status.sql`, run.

(`cat apps/psg-hub/supabase/migrations/20260623190000_*.sql` to copy them — you're already in the repo.) No
ledger surgery needed; the phantom `20260624130000` row is harmless once the table actually exists. Then verify:
```sql
select column_name from information_schema.columns
 where table_schema='public' and table_name='ccc_accounts' order by 1;   -- expect connection_status, declined_reason, error_reason, …
```
After applying, `get_advisors(security)` should show **no new** ERROR/WARN vs baseline.
Rollback if needed: `drop table public.ccc_api_call_log, public.ccc_accounts;` (also removes the Phase-3 columns).

### 4b. Pick real shop UUIDs  (Supabase dashboard → SQL editor, read-only)
```sql
select id, name from public.shops order by name limit 5;
```
Use two of these ids below as `:shopA` / `:shopB`.

### 4c. Seed the smoke rows  (SQL editor; service-role bypasses RLS)
All rows tagged `SMOKE-*` for clean teardown. **Omit the orphan row** — see the AC4 caveat (NOT NULL).
```sql
insert into public.ccc_accounts (shop_id, ccc_account_id, facility_id, credential_kind, status,
                                 connection_status, enabled_at, last_event_at, last_event_label)
values
  (:shopA, 'SMOKE-PENDING-1',  'F-1001', 'unconfirmed', 'linked', 'pending_review', now(), now(), 'Enabled in CCC'),
  (:shopB, 'SMOKE-CONNECTED',  'F-1002', 'unconfirmed', 'linked', 'connected',      now(), now(), 'Connection approved'),
  (:shopA, 'SMOKE-ERROR',      'F-1003', 'unconfirmed', 'error',  'error',          now(), now(), 'Ingest auth failed'),
  (:shopB, 'SMOKE-DECLINED',   'F-1004', 'unconfirmed', 'linked', 'declined',       now(), now(), 'Request declined');
update public.ccc_accounts set declined_reason = 'Smoke: not an active BSM site' where ccc_account_id = 'SMOKE-DECLINED';
update public.ccc_accounts set error_reason    = 'auth_failed' where ccc_account_id = 'SMOKE-ERROR';
```
Expected tab counts with this set: **Pending 1 · Connected 1 · Errors 1 · All 4** (no Declined tab; declined shows only under All). Adjust the runbook's "2 / 5" numbers down by the missing orphan row.

### 4d. Sessions
- **Superadmin:** grant yourself (find your auth uid in dashboard → Authentication → Users, or
  `select id, email from auth.users where email = '<you>';`):
  ```sql
  insert into public.app_user_roles (profile_id, role) values (:myUid, 'psg_superadmin')
    on conflict (profile_id) do update set role = 'psg_superadmin';
  ```
- **Non-superadmin (AC1):** log in as any account **without** `psg_superadmin` — a normal shop user, or a
  `psg_internal` user that lacks the `manage_ccc_integration` capability. Confirm the restricted notice + the
  nav entry to this route is hidden. (Don't downgrade your own row mid-test; use a second browser/account.)

### 4e. Verify the audit trail + clean up
```sql
-- after each AC3 transition:
select action, actor_profile_id, target_shop_id, payload_jsonb, created_at
  from public.access_audit
 where action like 'ccc.connection.%'
 order by created_at desc;

-- teardown when done (also removes any approved/declined SMOKE rows):
delete from public.access_audit where action like 'ccc.connection.%'
   and payload_jsonb->>'cccAccountId' like 'SMOKE-%';   -- only if your access_audit is delete-able; it is append-only by policy, so superadmin/service-role only
delete from public.ccc_accounts where ccc_account_id like 'SMOKE-%';
```
> Note: `access_audit` is **append-only** (INSERT-only policy) — the smoke will leave a few `ccc.connection.*`
> rows behind. That is expected/by-design; they are honest audit history of the smoke and can be left in place.

### Lighter-touch alternative (recommended if you'd rather not write synthetic rows to prod)
Apply the migration (§4a), then verify **AC1 (gate)** + **AC2 (the queue renders; an empty queue is itself a
valid render of the real env)** only, and rely on the green unit/integration suite (PSG-298) for the
AC3/AC4/AC5 transition logic — those are pure state-machine + route tests, not env-dependent. This proves the
deploy is wired (gate + service-client read + page render) without seeding prod.

## 5. Follow-up filed
- **Schema gap (AC4):** `ccc_accounts.shop_id NOT NULL` makes the unmatched/link-to-shop flow unreachable in
  prod. Filed to the PSG-267 owner to decide: relax to nullable, or document the UI as future-only. The live
  AC4 step is skipped until that lands (logic already covered by PSG-298 unit tests).
