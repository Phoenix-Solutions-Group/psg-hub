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
- migrations: `supabase/migrations/20260624130000_ccc_phase3_connection_status.sql` +
  `supabase/migrations/20260624150000_ccc_accounts_shop_id_nullable.sql` (PSG-305, `shop_id` → nullable)

---

## 1. Setup (operator)

### 1a. Apply the migration (operator gate — PROTOCOL-migration-safety)

Apply BOTH migrations in the target **test/pilot** env:
- `20260624130000_ccc_phase3_connection_status.sql` — additive + idempotent (`add column if not exists` on
  `ccc_accounts`; one partial index; no data written; existing RLS unchanged). Rollback = drop the eight
  added columns (see the migration header).
- `20260624150000_ccc_accounts_shop_id_nullable.sql` — relaxes `ccc_accounts.shop_id` to **NULLABLE**
  ([PSG-305]) so the unmatched/link-to-shop flow + AC4 are reachable as designed. No access widening: a NULL
  `shop_id` makes the membership SELECT predicate not-true, so an unmatched row is invisible to every customer
  session and only the service-role superadmin queue sees it (see the migration header). Rollback =
  `alter column shop_id set not null` (only while no NULL-shop_id rows exist).

> ⚠️ Do **not** apply against shared/prod without an explicit go-ahead. Test/pilot only.

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

> ✅ **Resolved ([PSG-305]):** the original Phase-1A schema declared `ccc_accounts.shop_id` **`NOT NULL`**,
> which made the orphan row (`shop_id = null`) unseedable and the whole unmatched/link-to-shop UI unreachable.
> Migration `20260624150000_ccc_accounts_shop_id_nullable.sql` (§1a / §4a) relaxes it to NULLABLE, so once
> applied AC4 is seedable and fully testable as designed. **Seed the orphan row** (`shop_id = null`) below.
> No access is widened — a NULL `shop_id` is invisible to every customer session (the membership SELECT
> predicate is not-true), so only the service-role superadmin queue sees an unmatched row. AC4's transition
> logic is also already covered by unit tests on the merged tree (PSG-298 PASS).

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

### 4a. Apply the migration  (operator gate — `supabase db push`)
The migration MCP tools are read-only inspection only here; schema changes go through the CLI so the review
trail + history stay in sync:
```bash
cd apps/psg-hub
supabase login                 # one-time; uses the OS keychain — never pass --password/--token inline
supabase db push               # applies all pending migrations incl. 20260624130000_ccc_phase3_connection_status
                               #   AND 20260624150000_ccc_accounts_shop_id_nullable (PSG-305)
supabase migration list        # confirm BOTH 20260624130000 and 20260624150000 show as applied (remote)
```
After push, run `get_advisors(security)` (read-only MCP) and confirm **no new** ERROR/WARN vs the baseline.
Rollback if needed: `alter table public.ccc_accounts drop column connection_status, last_event_at, last_event_label, enabled_at, approved_by, approved_at, declined_reason, error_reason, data_scope;`
and (PSG-305, only while no NULL-shop_id rows exist) `alter table public.ccc_accounts alter column shop_id set not null;`

### 4b. Pick real shop UUIDs  (Supabase dashboard → SQL editor, read-only)
```sql
select id, name from public.shops order by name limit 5;
```
Use two of these ids below as `:shopA` / `:shopB`.

### 4c. Seed the smoke rows  (SQL editor; service-role bypasses RLS)
All rows tagged `SMOKE-*` for clean teardown. The orphan row (`shop_id = null`) is now seedable after the
PSG-305 nullable migration (§4a) — include it to exercise AC4.
```sql
insert into public.ccc_accounts (shop_id, ccc_account_id, facility_id, credential_kind, status,
                                 connection_status, enabled_at, last_event_at, last_event_label)
values
  (:shopA, 'SMOKE-PENDING-1',  'F-1001', 'unconfirmed', 'linked', 'pending_review', now(), now(), 'Enabled in CCC'),
  (null,   'SMOKE-ORPHAN',     'F-1000', 'unconfirmed', 'linked', 'pending_review', now(), now(), 'Enabled in CCC'),
  (:shopB, 'SMOKE-CONNECTED',  'F-1002', 'unconfirmed', 'linked', 'connected',      now(), now(), 'Connection approved'),
  (:shopA, 'SMOKE-ERROR',      'F-1003', 'unconfirmed', 'error',  'error',          now(), now(), 'Ingest auth failed'),
  (:shopB, 'SMOKE-DECLINED',   'F-1004', 'unconfirmed', 'linked', 'declined',       now(), now(), 'Request declined');
update public.ccc_accounts set declined_reason = 'Smoke: not an active BSM site' where ccc_account_id = 'SMOKE-DECLINED';
update public.ccc_accounts set error_reason    = 'auth_failed' where ccc_account_id = 'SMOKE-ERROR';
```
Expected tab counts with this set: **Pending 2 · Connected 1 · Errors 1 · All 5** (no Declined tab; declined
shows only under All) — matching the §1b table and the §3 evidence grid.

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
- **Schema gap (AC4) — RESOLVED ([PSG-305]):** the Phase-1A `ccc_accounts.shop_id NOT NULL` constraint made
  the unmatched/link-to-shop flow unreachable. Decision (owner PSG-267): **relax `shop_id` to nullable** —
  the handshake design intentionally creates a CCC account row before it is matched to a PSGID, and a NULL
  `shop_id` is invisible to customer sessions (no access widening). Delivered as migration
  `20260624150000_ccc_accounts_shop_id_nullable.sql`; once the operator applies it (§4a), the live AC4 step is
  no longer skipped — seed the orphan row (§4c) and run it.
- **Non-blocking Phase-2 note:** the foundation's `unique (shop_id, ccc_account_id)` upsert target treats NULL
  `shop_id` as distinct, so it does not dedupe two unmatched rows sharing a `ccc_account_id`. If duplicate
  unmatched ingest becomes real, add a partial unique index on `(ccc_account_id) where shop_id is null` in the
  ingest phase (see the migration header).
