# CHECKLIST — RLS Review (S4)

**Phase:** 06-rbac-rls-spine · **Established:** 2026-06-02 (06-01) · **Run for:** every migration that creates a table, view, function, or policy on `gylkkzmcmbdftxieyabw`.

Companion to `PROTOCOL-migration-safety.md`. The protocol says *how* migrations ship; this checklist says *what every new table/policy must satisfy* before `db push`. Tick every box per migration.

---

## Per-table reader decision (do this FIRST)

For each new table, decide who reads it — this determines the policy shape:

- [ ] **Read by the anon/authenticated client (PostgREST Data API)?** → it NEEDS a scoped policy `to authenticated` (never a blanket allow). Customers clamp on shop; ops clamp on function grant.
- [ ] **Service-role only (server writes, no client read)?** → enable RLS and add **zero policies**. RLS-on + no-policy = default-deny for anon/authenticated, while service-role bypasses RLS. That is sufficient; do not add a permissive policy "just in case."

A table with no decided reader defaults to service-role-only (RLS-on, no policy).

## RLS enablement

- [ ] `enable row level security` is in the **SAME migration** as `create table` (never a follow-up migration — the gap is an exposure window).
- [ ] New table is in `public` (D1=A1) — confirm it is intended to be Data-API-reachable; if not, reconsider per the reader decision above.

## Policy correctness

- [ ] Every policy targets **`to authenticated`** — never `public`, never `anon`. (The 26 legacy `anon`-open policies are Phase-8 scope; do not add new ones.)
- [ ] `auth.uid()` is wrapped as **`(select auth.uid())`** in every policy expression (initplan caching — avoids per-row re-evaluation at scale).
- [ ] **Customer** access clamps on `shop_id in (select user_shop_ids())` (per-shop grain, D4) — reuses the helper already running on ~20 prod tables.
- [ ] **Ops / superadmin** access gates on `current_user_has_fn('<fn>')` (the functions_jsonb gate), not on a hardcoded role string.
- [ ] **UPDATE policies also have a matching SELECT policy** — an UPDATE must SELECT the row first; without a SELECT policy the update silently affects 0 rows.
- [ ] New tables FK to **`profiles(id)`** for ownership (`profiles.id == user_id == auth.uid()`, W4) — not to `auth.users` directly.

## Helper functions (security-definer subqueries)

- [ ] Helpers are `STABLE`, `SECURITY DEFINER`.
- [ ] Helpers live in a dedicated **`private`** schema — **NEVER** `public` or any PostgREST-exposed schema (a security-definer function in an exposed schema is a privilege-escalation surface).
- [ ] Every helper has **`SET search_path = ''`** and uses fully-qualified references (`public.shop_users`, etc.) — clears `function_search_path_mutable` and prevents search-path hijack.
- [ ] The 3 existing helpers (`user_shop_ids()`, `user_location_ids()`, `user_is_shop_owner()`) get `SET search_path` added in **06-02** (clears the search-path warns where they apply). Do not rewrite their bodies.

## Idempotency (re-run safety)

- [ ] `create table if not exists`
- [ ] `drop policy if exists "<name>" on <table>;` before each `create policy`
- [ ] `create or replace function`
- [ ] Seed inserts use `on conflict (...) do nothing` / `do update` (e.g. superadmin bootstrap = Nick)

## Advisor gate

- [ ] After push, `get_advisors(security)` run and diffed against the **re-captured** baseline (per PROTOCOL §4). No NEW ERROR/WARN, or the loop is blocked.

---

*Authoring source: `06-RESEARCH-DOSSIER.md` (§3 D1 protocol, §5 boundaries). Supabase RLS conventions: enable-RLS-with-create-table, `to authenticated`, `(select auth.uid())`, security-definer helpers in an unexposed schema.*
