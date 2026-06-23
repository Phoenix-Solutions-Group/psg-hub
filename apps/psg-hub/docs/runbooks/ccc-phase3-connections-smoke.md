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

### 1a. Apply the migration (operator gate — PROTOCOL-migration-safety)

Apply `20260624130000_ccc_phase3_connection_status.sql` in the target **test/pilot** env. It is additive +
idempotent (`add column if not exists` on `ccc_accounts`; one partial index; no data written; existing RLS
unchanged). Rollback = drop the eight added columns (see the migration header).

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
