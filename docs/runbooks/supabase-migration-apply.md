# Runbook — Supabase migration apply & drift check (psg-hub)

**Owner:** Ada (psg-hub infra/CI) · **Created:** 2026-06-22 (PSG-197)

## TL;DR — the gap this closes

The psg-hub deploy pipeline does **not** apply Supabase migrations.

- **Vercel** (`psg-digital/psg-hub`, prod = `main`) deploys a **build-only** Next.js
  app. It never touches the database.
- The only GitHub workflow, `.github/workflows/e2e.yml`, runs against a
  **throwaway local** Supabase stack on the runner — never prod.
- Migrations are applied **by hand** by an operator (gate batch via Supabase MCP
  `apply_migration`, per
  `apps/psg-hub/.paul/phases/06-rbac-rls-spine/PROTOCOL-migration-safety.md`).

Because that manual step is the *only* thing that ships schema, it has been
silently skipped. **PSG-197** found **7 migrations merged to `main` but never
applied** to prod (`localreach gylkkzmcmbdftxieyabw`), on top of the v1.3
production-mail tables found earlier (PSG-44, which 500'd the Lob webhook).

We intentionally keep a **human gate on prod DDL** (small team, live customer DB —
see PROTOCOL-migration-safety). So the fix is not "auto-apply on merge"; it is to
make drift **impossible to miss** (the drift check below, in CI + as a release
gate) and to make applying a **checklist, not tribal knowledge** (this runbook).

## Prod target

| | |
|---|---|
| Supabase project | **`localreach` / `gylkkzmcmbdftxieyabw`** |
| Migrations dir | `apps/psg-hub/supabase/migrations/` |
| Applied ledger | `supabase_migrations.schema_migrations` (`version`, `name`) |

> ⚠️ Supabase **re-stamps** the `version` column at apply time (especially via MCP
> `apply_migration`), and operators sometimes apply with a slightly different
> `name` (timestamp moved to a suffix, or an extra version infix). So reconcile by
> the **embedded name token sequence**, NOT the `version` column. `supabase
> migration list` (version-based) gives false results here — use the drift check.

## 1. Detect drift (run before every cutover go/no-go, and in CI)

```bash
# Live mode — needs psql (preinstalled on CI ubuntu runners) + a connection string.
SUPABASE_DB_URL="postgres://postgres:<pw>@<host>:5432/postgres" \
  node scripts/check-migration-drift.mjs        # or: pnpm migrations:check
```

Exit codes: **0** = no drift · **1** = drift (migrations merged but unapplied) ·
**2** = skipped (no DB URL / no `--applied-file`; CI treats this as a warning, not
a failure, so it no-ops until the `SUPABASE_DB_URL` secret is wired).

If you don't have a DB client handy, run it in **file mode** — paste the applied
ledger from MCP:

```sql
-- via Supabase MCP execute_sql against gylkkzmcmbdftxieyabw:
select name from supabase_migrations.schema_migrations order by version;
```

```bash
# save that result (raw MCP JSON array, or one name per line) to a file:
node scripts/check-migration-drift.mjs --applied-file /tmp/applied.txt
```

### 1a. Object-parity check (PSG-617) — catches what the ledger check cannot

The ledger check above only reconciles migration **records**. It is blind to objects
that exist in prod with **no ledger row at all** — exactly how the four `billing_*` /
`invoiced_*` tables and the `monthly-reports` / `ads-mutation-logs` / `public-assets`
buckets slipped in unrecorded (PSG-614). The object-parity check closes that gap by
diffing the live DB's **public tables + storage buckets** against the committed code
manifest `apps/psg-hub/supabase/schema-manifest.json`:

```bash
SUPABASE_DB_URL="postgres://...:5432/postgres" \
  node scripts/check-schema-drift.mjs            # or: pnpm schema:check
# file mode (paste one JSON row from MCP execute_sql — query is in the script header):
node scripts/check-schema-drift.mjs --objects-file /tmp/objects.json
```

Same exit codes (0 / 1 / 2). It reports drift **both** ways: `DB-ONLY` = an object in
prod but not in code (capture it into a migration); `CODE-ONLY` = an object in code but
not yet applied (apply it). After any **legitimate** schema change, regenerate the
manifest from a **clean code-built DB** (a fresh `supabase db reset`, never from prod):

```bash
node scripts/check-schema-drift.mjs --generate > apps/psg-hub/supabase/schema-manifest.json
```

## 2. Apply missing migrations (operator gate)

For **each** drift entry the check lists, **in timestamp order**:

1. **Read the file** in `apps/psg-hub/supabase/migrations/`. Confirm it is
   additive/idempotent (`create table if not exists`, guarded constraints, `create
   or replace`). Flag anything that drops/rewrites data for extra review.
2. **Run any pre-checks** the migration's header comment calls out. (Example:
   `reconcile_subscription_tier` tightens `subscriptions_tier_check` and will FAIL
   if any row has `tier='multi_location'` — verify
   `select count(*) from subscriptions where tier='multi_location'` = 0 first.)
3. **Confirm dependencies exist** (referenced tables, functions like
   `public.user_shop_ids()` / `private.current_user_role()`, columns).
4. **Apply** via Supabase MCP `apply_migration` with **`name` = the embedded
   snake_case name** (e.g. `verified_facts`, not `20260620120000_verified_facts`).
   Keeping the name = the file's embedded name makes the drift check match cleanly.
5. **Capture an advisor baseline+diff** (`get_advisors` security/perf) before and
   after, per PROTOCOL-migration-safety. New `rls_enabled_no_policy` INFO findings
   on default-deny service tables are expected, not a finding.
6. **Verify the objects exist** (`information_schema` / `pg_proc` / `pg_trigger`).
7. **Re-run the drift check** — it must now report **0**.

## 3. Keep it from regressing

- CI runs the drift check on push + PR to `main`
  (`.github/workflows/migration-drift.yml`). It **enforces** (fails on drift) the
  moment a read-only `SUPABASE_DB_URL` repo secret is configured; until then it
  warns and passes. Adding that secret is an operator/board action (see below).
- **Whoever merges a PR that adds a migration owns getting it applied** (step 2)
  before the next cutover go/no-go, and re-runs the check to prove 0 drift.

### Operator one-time activation (board-gated secret)

Add a **read-only** Postgres connection string for `gylkkzmcmbdftxieyabw` as the
GitHub Actions secret `SUPABASE_DB_URL` (a role with `connect` + `select` on
`supabase_migrations.schema_migrations` is sufficient — it never needs write).
Once set, every merge to `main` fails CI if a migration is merged but unapplied,
turning a silent gap into a loud, blocking signal.

## Appendix — PSG-197 reconciliation (2026-06-22)

7 migrations were merged-but-unapplied and applied this pass (timestamp order):
`monthly_reports_claim`, `stripe_webhook_events`, `reconcile_subscription_tier`,
`invoices_and_payment_events`, `module_registry`, `verified_facts`,
`content_items_publish_gate`. Post-apply drift check = 0.

> Note: 6 of these 7 migration files are in `main` as of this writeup.
> `content_items_publish_gate` (`20260622120000_content_items_publish_gate.sql`)
> was applied to prod in the same pass, but its file lands via a separate
> feature branch — so a drift run on `main` before that branch merges sees
> only 6 of these names as repo files; the 7th surfaces as a benign
> "no matching repo file" ledger note, not drift. Expected.
