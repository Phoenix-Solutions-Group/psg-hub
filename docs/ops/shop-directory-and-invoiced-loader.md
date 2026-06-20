# PSG shop / PSGID registry + Invoiced loader (PSG-139)

Follow-up from PSG-132 (registry escalated because `shops/registry.ts` imported the
real `invoiced-customers.json` = shop billing PII) and PSG-130 (Steve flagged same).

## 1. Registry / resolver port — structure only, no committed data

Ported `import/src/lib/shops/{registry,resolver}.ts` into
`apps/psg-hub/src/lib/ops/import/shops/`, **without** bringing
`invoiced-customers.json` (842 real shops + billing fields) into the repo.

| File | Role |
| --- | --- |
| `types.ts` | Interfaces only (a schema, not data). `EMPTY_SHOP_REGISTRY` is the safe in-repo default — the old hardcoded `DEFAULT_SHOP_REGISTRY` (5 named shops + PSGIDs) was **dropped** as committed customer data. |
| `directory.ts` | `ShopDirectory` — the in-memory lookups (`lookup`, `byId`, `parentGroups`, `msoGroups`, `getMSOChildren`). Built from an **injected** `InvoicedShop[]`; replaces the module-level globals the old code hydrated from JSON. `buildMSOGroups` is pure. |
| `resolver.ts` | `resolveShops` / `resolveShopsConstrained` / `autoDetectAndResolve` — matching logic unchanged; now takes a `ShopDirectory` param (default empty) instead of reading a module global. |
| `loader.ts` | Runtime data source (see below). |

### Where the data comes from now
The shop/PSGID dataset is loaded at runtime, never committed:

1. **Live DB** — `loadShopDirectoryFromDb(client)` selects from
   `public.invoiced_customers` (RLS: `invoiced_customers_psg_admin_select`,
   psg_admin only; default-deny otherwise). The caller picks the client (RLS-scoped
   server client for request paths, service client for trusted ingestion) — RLS is
   the enforcement boundary. Billing fields ride along in the row `metadata` jsonb
   and are overlaid by `mapInvoicedRow`.
2. **Env/secret-backed** — `shopDirectoryFromEnv(env, "OPS_SHOP_DIRECTORY_JSON")`
   parses an operator-supplied JSON array, for CI/offline contexts. Fail-closed:
   missing/invalid → empty directory (import degrades to "unresolved", never crashes).

No `invoiced-customers.json` import anywhere. Tests use synthetic fixtures only.

Coverage: 23/23 vitest pass, **94.4% lines** on the new module (well above the 70%
gate); `tsc --noEmit` and `eslint` clean.

> Not yet wired into the import route — this is the de-PII'd module + loader. Live
> wiring (calling `loadShopDirectoryFromDb` from the validate/commit path) is a
> small follow-up once Ada confirms which client the import route should use.

## 2. Script comparison — `refresh-invoiced-customers.ts` vs `import-invoiced-customers.mjs`

Both touch billing/PII, so they were folded into this PII-aware ticket.

| | `import/scripts/refresh-invoiced-customers.ts` (import repo) | `psg-advantage-portal/scripts/import-invoiced-customers.mjs` (in-hub) |
| --- | --- | --- |
| Data source | **Invoiced.com API** (per `.paul/codebase/STRUCTURE.md`, `INTEGRATIONS.md` — "script may write to the same DB") | a JSON file at a path arg → DB |
| Sink | regenerates the JSON / writes shared Supabase | idempotent upsert into `invoiced_customers` (`BEGIN`; `TRUNCATE`; `ON CONFLICT (invoiced_id) DO UPDATE`; `COMMIT`/`ROLLBACK`) |
| External dep | Invoiced.com creds | none (pg only) |
| Alignment with BSM | ❌ Invoiced.com was **dropped** for Stripe-native billing (PSG-56/59) | ✅ DB-native, matches PSG-139 "source from live DB" |

### Recommendation (the call)
**Keep the in-hub `import-invoiced-customers.mjs`** as the canonical
load-into-`invoiced_customers` path; **drop the Invoiced-API
`refresh-invoiced-customers.ts`** — its data source (Invoiced.com) is a
board-decommissioned integration (Stripe-native, PSG-56/59), so porting it would
re-introduce a dead dependency and a credential surface.

Two hardening notes on the kept script (not blockers; non-PII because it commits no
data itself — the dataset is passed in at runtime):
- It defaults `sourcePath` to a developer's local absolute path. For hub use it
  should **require** the path arg (or read stdin) — no hardcoded default — and the
  source file must be operator-supplied and uncommitted.
- It `TRUNCATE`s before reinsert inside one transaction (fine — atomic), but pair it
  with the env loader above so CI never needs a file.

### Caveat on the comparison
`import/scripts/refresh-invoiced-customers.ts` was **not** harvested into
`docs/harvest/import-repo/` (the `scripts/` dir was excluded), so this comparison
rests on its documented purpose (Invoiced.com API source) rather than a byte-level
read. The conclusion — drop the Invoiced.com-dependent script — follows directly
from the board-level Stripe-native decision and does not hinge on the exact source.
If Ada wants the literal diff confirmed, the import-repo source can be pulled via the
PSG-130 read-bridge (Steve paste) before the `import` repo is decommissioned (PSG-50).
