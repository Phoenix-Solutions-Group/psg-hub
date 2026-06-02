# PROTOCOL — Migration Safety (S1 gate)

**Phase:** 06-rbac-rls-spine · **Established:** 2026-06-02 (06-01) · **Binding on:** 06-02, 06-03, and every later plan that touches the database.

This is the S1 gate. It exists because all psg-hub DDL lands on a **shared production project** (`gylkkzmcmbdftxieyabw`, dashboard name "localreach") that holds **314,828 PII rows across 142 shops** and the tables of sibling apps (psg-advantage-portal, market-intelligence, the `sensitive` schema). A careless migration here is a multi-tenant prod incident, not a local mistake. Read this before writing any migration.

---

## 1. Chosen architecture (path-A, locked 06-01)

| Fork | Decision |
|------|----------|
| D1 — where customer tables live | **A1: shared project, `public` schema, shared-mutate** under this protocol. No separate project, no isolated schema. |
| D2 — claims mechanism | **No hook.** Role/shop authority is an **in-DB security-definer subquery** (`current_user_role()` / `current_user_has_fn()`), NOT a JWT access-token hook. A custom access-token hook is PROJECT-GLOBAL and would rewrite sibling-app tokens — forbidden. |
| D3 — 26 anon-open policies | **Defer to Phase 8** (M2 PII gate). Do NOT drop or retrofit them in Phase 6. |
| D4 — MSO grain | **Per-shop** (`shop_users.shop_id`, reuse `user_shop_ids()`). |
| D5 — `profiles.role` (free-text) | **Vestigial.** New CHECK-constrained `app_user_roles` is authoritative; existing `profiles.role` rows are not migrated. |
| Superadmin bootstrap (06-02) | **Nick only** (nick@phoenixsolutionsgroup.net). Claire (claire@static-solutions.com) **removed** from admin. Brian **not provisioned** (no auth row). |

Because no hook is installed and customer tables are greenfield (nothing reads them yet), new tables cannot break existing readers — shared-mutate is safe under the rules below.

---

## 2. Migrations-as-code is the ONLY path for DDL

From 06-01 onward, **every** schema change to `gylkkzmcmbdftxieyabw` follows the migrations-as-code workflow — a reviewed in-repo migration file, no exceptions.

1. `supabase migration new <descriptive_name>` — never hand-invent a filename or timestamp.
2. Write the SQL. Review it against `CHECKLIST-rls-review.md`.
3. `supabase db push` to apply.
4. Verify (advisors diff — §4) and `supabase migration list` to confirm it registered.

**The read-only-MCP rule:** the Supabase MCP `execute_sql` / `apply_migration` tools and `supabase db query` are **read-only inspection only** from now on. They MUST NOT be used to change schema — they bypass the review trail and desync `db pull`/`db diff`. (This is a change from the Phase-3 workflow, which used MCP `apply_migration` directly.) `list_migrations`, `list_tables`, `get_advisors`, read-only `execute_sql` SELECTs = allowed for inspection.

**Repo baseline (06-01):** `supabase/migrations/<ts>_remote_schema.sql` is a **read-only `supabase db dump` snapshot** of remote state (db-pull was unusable — see 06-01 SUMMARY). It is committed but **NEVER pushed/executed**. The 5 historical remote versions (`location_paperclip_mapping`, `market_viewport_intelligence`, `google_profile_shop_matching`, `create_email_events`, `create_sms_events`) legitimately remain remote-only.

**History reconciliation is 06-02's job, not 06-01's.** Local has 1 baseline file; remote has 5 versions local lacks. Before 06-02's first `db push`, align history with `supabase migration repair --status applied <version>` for the baseline (note: **`applied`**, NOT the `reverted` the CLI error message suggested — reverted is the wrong direction and is a prod write made for the wrong reason). 06-02 planning must PROVE `db push` goes clean after the repair; do not assume it is trivial.

---

## 3. Per-migration hard rules

- **One transaction** per migration.
- **Idempotent:** `create table if not exists`, `drop policy if exists` before `create policy`, `create or replace function`, `on conflict` on seed inserts.
- **Reversible:** note the down/rollback approach in a comment (drop the objects the migration created, in reverse dependency order). There is no automatic down-migration — write the rollback SQL you would run if the push must be reverted.
- **RLS review:** every new table passes `CHECKLIST-rls-review.md` before push.

---

## 4. Post-migration advisor gate

After every `db push`, run **`get_advisors(security)`** and DIFF against the baseline. Any NEW security ERROR/WARN introduced by the migration **blocks the loop** until resolved.

**Baseline captured 2026-06-02** via read-only `get_advisors(security)` on `gylkkzmcmbdftxieyabw`. Pre-existing noise to IGNORE (not introduced by Phase 6):

| Finding | Count | Why ignored |
|---------|-------|-------------|
| `security_definer_view` (ERROR) | 5 | Pre-existing sibling-app views |
| `rls_disabled_in_public` | 1 | `spatial_ref_sys` (PostGIS system table) |
| `rls_policy_always_true` | 26 | The anon-open policies — Phase-8 scope (D3) |
| `rls_enabled_no_policy` | 50 | Intended default-deny tables |
| `function_search_path_mutable` | 32 | Pre-existing; 06-02 hardens the 3 helpers it touches |

**These counts are a dated snapshot, not a frozen constant.** The shared DB drifts as sibling apps ship. **06-02 MUST RE-CAPTURE** the baseline with `get_advisors(security)` at apply time and diff new findings against that fresh capture — not against this table.

---

## 5. Hard DO-NOTs (boundaries)

- Do **not** drop or alter the 26 anon-open (`Allow all`) policies — Phase 8 (D3).
- Do **not** install a project-global custom access-token hook (path-A = no hook; only ever if path-B were chosen, which it was not).
- Do **not** touch the `sensitive` schema or any sibling-app table (`portal_users`, `body_shops`, `survey_responses`, market-intelligence tables, etc.).
- Do **not** rewrite existing rows in `shop_users` / `portal_users` / `profiles`.
- Do **not** put `SECURITY DEFINER` helpers in `public` or any PostgREST-exposed schema — they go in `private` (§ CHECKLIST).
- **Secrets:** never pass the Supabase access token or Postgres DB password as inline CLI args (`-p`/`--password`/`--token`); use `supabase login` + the OS keychain. Never commit a password or set `SUPABASE_DB_PASSWORD` in a tracked file.

---

*Companion: `CHECKLIST-rls-review.md` (S4 per-table RLS review). Authoring source: `06-RESEARCH-DOSSIER.md`.*
