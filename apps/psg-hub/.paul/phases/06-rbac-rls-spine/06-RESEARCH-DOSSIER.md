# Phase 6 Research Dossier — RBAC + RLS Spine

> **Provenance:** Read-only grounding workflow `wf_ddd01605-c64` (2026-06-02), 6 agents / ~707k subagent tokens / 152 tool uses. Five research streams (A code/design-intent · B live shared-prod introspection · C blast-radius · D S1 migration-safety · E roles/claims) synthesized. **Zero DDL/DML applied** — all DB facts from SELECT/list/get against live project `gylkkzmcmbdftxieyabw` ("localreach", Postgres 17.6, us-east-2). This dossier is the single authoring source for `06-01-PLAN.md` + the `06-02`/`06-03` split.

---

## The one-line spine

The S1 "shared-vs-isolate" fork is **not independent** of the claims-mechanism fork. Agent C's *isolate* verdict is driven entirely by the project-global token hook. Agents D and E independently recommend **no hook** (security-definer subquery). **Choose no-hook → shared-mutate-under-protocol becomes safe and all five streams agree.** That coupling is the central decision of 06-01.

---

## 1. GROUNDED REALITY (verified facts; ROADMAP assumptions flagged WRONG)

The ROADMAP frames Phase 6 as "reconcile/extend the BSM Phase 4 role enum + extend the deployed RLS base." **Live reality contradicts the premise at six points.** Each is verified, not inferred.

| # | ROADMAP assumption | Verified reality | Source |
|---|---|---|---|
| **W1** | A role enum exists (`owner/manager/viewer`) to reconcile/extend | **No Postgres enum, ZERO CHECK constraints** on any role column. `profiles.role`, `portal_users.role`, `shop_users.role` are all unconstrained free-text. Phase 6 must **DEFINE** the 3-role vocabulary, not extend one. | B, D, E |
| **W2** | `security_profiles.functions_jsonb` exists to gate ops tables | **`security_profiles` does not exist.** It is **greenfield to CREATE**, not "extend." | A, B, E |
| **W3** | "BSM Phase 4 auth/RLS base to extend" is deployed | **The BSM base was NEVER deployed here.** psg-hub's code reads `shop_members` (`profile_id`, role enum), `get_user_shop_ids()`, `google_ads_accounts/_campaigns`, `agent_runs`, `review_sources` — **all absent from the live DB.** Every inherited customer surface (dashboard/ads, reviews scoping, onboarding membership write, all api/ads+reviews+content authz) **errors at runtime today.** Only `/login`, the dashboard shell, and `email_events`/`sms_events` webhooks actually work. | A, C |
| **W4** | "honor the `profile_id` convention" implies a `profile_id`-vs-`user_id` reconciliation | **No conflict exists.** `profiles.id` = `portal_users.id` = `shop_users.user_id` = `auth.users.id` **in value** (verified by join). The ROADMAP's `profile_id` and the on-disk `user_id` are the **same value = `auth.uid()`**. New tables FK to `profiles(id)` and the convention is honored automatically. | E |
| **W5** | "no migration tracking" | **Migrations ARE tracked remotely** — `supabase_migrations.schema_migrations` has 5 rows (incl. `create_email_events`, `create_sms_events`). The real gap is **repo linkage**: no in-repo `supabase/` dir, no `config.toml`, no `.sql` files. "Migrations-as-code" = `supabase db pull` existing history + link CLI, **not** introduce tracking from scratch. (The BSM `shops`/`shop_users` DDL is itself untracked — it drifted in.) | A, B, D |
| **W6** | Seed superadmins **Nick / Tina / Brian** | Live `profiles` admins are **Nick, Tina, and Claire (`claire@static-solutions.com`, external domain)** — value is `'admin'`, not `'psg_superadmin'`. **Brian has no `auth.users` row at all.** Three apps use three free-text vocabularies: `profiles.role='admin'`, `shop_users.role='owner'`, `portal_users.role='psg_admin'`. | A, B, E |

**The actual deployed tenancy model** (the real reconciliation target — local_reach/psg-import lineage, NOT BSM):
- Membership: **`shop_users(user_id uuid, shop_id uuid, role text default 'viewer', location_ids uuid[])`**, keyed on `user_id`.
- Helpers (STABLE SECURITY DEFINER, **missing `SET search_path`** — harden): `user_shop_ids()`, `user_location_ids()`, `user_is_shop_owner(uuid)`.
- Two-level scope: `content_items` clamps on **both** `shop_id IN user_shop_ids()` AND `location_id IN user_location_ids()`. The BSM code has no concept of the location grain.
- `shop_users` self-insert is already blocked (`WITH CHECK = user_is_shop_owner(shop_id)`), so the **first owner of a new shop must be service-role-seeded** (relevant to superadmin bootstrap).

**Who authenticates here (token-pool reality):** Only **psg-hub** and **psg-advantage-portal** mint real Supabase Auth users (`signInWithPassword`/`signUp`/`exchangeCodeForSession`); they share the same **3-row `auth.users` pool** (only Nick has ever signed in). **psg-import uses NO Supabase auth** (shared-password + cookie) — outside both blast radii. The shared pool already contains an **external user** (`claire@static-solutions.com`, profiles-only, no membership).

**The live security hole that gates everything:** ~12 tables carry **26** permissive `qual=true` policies (`Allow all for anon` + `Allow all for authenticated`). Postgres **OR-combines** permissive policies, so these **nullify** the correct scoped policies that already sit alongside them (`shops_select = id IN user_shop_ids()` exists but is defeated). Wide-open today: `shops, clients, profiles, reviews, campaigns, pages, discovery_briefs, research_artifacts, configs, skills, elements, activity_log`. **`profiles` (default role `'admin'`) is anon-WRITABLE** = a live privilege-escalation path if `profiles.role` is ever made authoritative.

**Also live (sharpens S1):** the double-locked `sensitive` schema (RLS-on, zero policies, granted only to `postgres`/`service_role`) holds **314,828 real PII rows across 142 shops** (159k emails, 209k phones), plus live customer rows in `shops`/`clients`. Any Phase 6 DDL on this project is DDL on a multi-client PII prod DB.

---

## 2. BLAST-RADIUS VERDICT (table-by-table — uses C's ground-truthed corrections)

**"Default-deny" here = dropping the 26 always-true policies so scoped policies bind.** It is **~12 tables carrying 26 policies** (anon + authenticated variants of "Allow all"), not "26 tables." Agent B mis-bucketed `content_items` as wide-open; **C corrected it — `content_items` is already scoped.**

### Default-deny RLS — what actually breaks

| Table | Live? | Read path | Current policy | Breaks under default-deny? |
|---|---|---|---|---|
| **shops** | YES | psg-hub reviews page `.select(id,name)` via **anon**; ads page + `tier.ts` via **service** | `Allow all` + scoped `shops_select` | **THE ONE GENUINE REGRESSION.** Anon read goes empty for any user lacking a `shop_users` row. **Only Nick has one** → the regression only ever served Nick. Service reads unaffected. |
| **content_items** | YES | psg-hub via anon | **Already scoped**, no anon-all | **NO** — already default-deny. |
| **subscriptions** | YES | anon + service | Already scoped | **NO**. |
| **profiles** | YES | Neither app reads via anon | `Allow all` — **anon-WRITABLE, role default `admin`** | **NO breakage; pure security WIN** (closes anon privesc). |
| **clients** | YES | Neither app reads via anon | `Allow all` — real customer data | **NO breakage; pure security WIN.** |
| **reviews** | YES | psg-hub reviews page (anon) | `Allow all` | **N/A — already broken TODAY.** Live `reviews` is a content-suggestion table; psg-hub queries `shop_id/platform/rating/body` columns that **don't exist**. Customer reviews live in `review_items`. Schema-collision trap, not an RLS break. |
| **portal_users** | YES | adv-portal via anon (`id=auth.uid()` self-select) | `portal_users_self_select` | **NO** — self-select survives. |
| `campaigns, pages, discovery_briefs, research_artifacts, configs, skills, elements, activity_log` | YES | **Neither app reads via anon** (adv-portal reads via service/PG) | `Allow all` | **NO breakage; pure security WIN.** |
| **Phantom** (`shop_members`, `google_ads_*`, `agent_runs`, `review_sources`) | **NO** | psg-hub code | n/a | **Nothing to break** — net-new DDL, the S1 concern. |

**adv-portal is UNAFFECTED by default-deny:** all customer/market data flows through **service-role** (`callRpc` prefers `SUPABASE_SERVICE_ROLE_KEY`) + a superuser PG pool — both RLS-bypass. Its only anon read is `portal_users` self-select, which survives.

### Global-hook risk (the genuinely dangerous action)

No hook exists today (verified absent in `pg_proc`). A custom access-token hook is **PROJECT-GLOBAL** (GoTrue level) — it rewrites **every** token the project issues, including adv-portal's and external user Claire's. Doc-grounded: Supabase **returns an error if required claims are absent after the hook runs**, so a hook that throws or drops a claim **breaks login for every app on the project**. Safe-additive ONLY IF purely additive, never-throwing, AND tolerant of zero-membership users (Tina, Claire, adv-portal admins all have `shop_users_rows=0`). **It cannot be scoped to psg-hub alone.** That non-scopability is the tie-breaker.

### One-line verdict

> **MUTATE-SHARED-UNDER-PROTOCOL — conditional on choosing NO project-global hook.** The default-deny RLS work is safe (one cosmetic regression, only ever served Nick) and new customer tables are born default-deny for free. The ONLY action that forces "isolate" is the global hook — and D+E independently recommend not installing it. **Remove the hook → the isolate objection (Agent C) dissolves → all five streams converge on shared-mutate.**

---

## 3. THE OPERATOR FORKS (become `checkpoint:decision` in 06-01)

**These three forks are NOT independent. D2 is the lever that resolves D1.** Decide D2 *first*; D1's recommendation is *conditional on* D2.

### D2 — CLAIMS MECHANISM (decide FIRST; it gates D1)

How role + `shop_id` resolve into RLS.

- **(b) In-DB subquery / security-definer helper — RECOMMENDED DEFAULT.** RLS policies call `current_user_role()` and `shop_id IN (SELECT user_shop_ids())`.
  - *Pros:* **Zero project-global surface** (adv-portal tokens untouched). **Always-live** (revocation reflected on next query). Single mechanism for customer + ops. **Not a per-request round-trip** — the subquery runs in-statement, helper is `STABLE` + statement-cached. The bucket-B pattern **already runs correctly in prod**. `functions_jsonb` (ops gate) is too large/volatile for a JWT, so even mechanism (a) would still need a subquery for ops.
  - *Cons:* Edge middleware (the "customer-id-required" check) can't use an in-query subquery → needs one lightweight role+shop lookup per request (trivial: 3 users, near-zero traffic). RLS remains the real boundary; middleware is a UX/redirect gate.
- **(a) Custom access-token hook (role + `shop_id` claims).** *Pros:* claims available pre-DB (middleware-friendly); matches ads-dashboard 01-03 design intent. *Cons:* **PROJECT-GLOBAL** (rewrites adv-portal + Claire's tokens); **stale ~1hr on grant/revoke** (a security defect for RBAC, not just UX lag); unbounded token size for MSO; **can't carry `functions_jsonb` anyway**; a throwing/claim-dropping hook **breaks login project-wide**.

**→ RECOMMENDED: (b) no hook.** Streams D and E both reach this independently; C concurs as its shared-path override.

### D1 — S1: SHARED-MUTATE vs ISOLATE (operator-blocking; **conditional on D2**)

Where Phase 6 tables live, given 314k PII rows across 142 shops on a multi-app prod DB.

- **A1 — Shared project, `public` schema, mutate under protocol — RECOMMENDED, IF D2=(b).** New tables created with `enable RLS` + scoped `to authenticated` policies in the same migration; adopt CLI migrations-as-code; resolve role/shop via security-definer helper (no hook).
  - *Pros:* lowest blast radius; no new infra/cost; reuses existing `auth.users`; internal/superadmin users span both apps naturally; new tables can't break existing readers (nothing reads them yet). *Cons:* customer tables sit alongside ops/PII (mitigated by the M2/Phase 8 PII gate); discipline-dependent (must NOT retrofit the 26 anon policies).
- **A2 — Shared project, isolated `customer` schema (not in PostgREST exposed list).** *Pros:* structural isolation without a second project; clean PII boundary; defense-in-depth. *Cons:* more wiring (schema exposure, grants, typed clients); RLS still required. **Sub-option of A1 — operator picks A1 vs A2 at plan time.**
- **A3 — Separate Supabase project — Agent C's verdict.** *Pros:* hard blast-radius wall; a hook there would be safe; cleanest compliance. *Cons:* **identity split** — adv-portal users already live in the shared `auth.users`, so any `psg_internal`/`psg_superadmin` spanning both apps needs accounts in both projects; new cost + env wiring; cross-project joins become app-layer work.

**Surfacing C's dissent honestly:** Agent C recommends **ISOLATE**. Its tie-breaker verbatim: *"token issuance cannot be scoped away from adv-portal on a shared project."* That objection is **entirely about the hook.** C's own override path: *"If staying shared: do NOT install the global token hook — derive role/shop_id from a per-request lookup."* Since D2's default is exactly that no-hook lookup, **C's isolate objection is mooted, and C converges with D/E on shared-mutate.**

**→ RECOMMENDED: A1 (shared, mutate under S1 protocol) — *because* D2=(b) removes the only force pushing toward A3.** If the operator chooses D2=(a) hook, the recommendation flips to A3 isolate.

### D3 — THE 26 ALWAYS-TRUE POLICIES (scope decision)

- **DEFER to M2 / Phase 8 PII gate — RECOMMENDED.** New-table default-deny needs nothing from this. Dropping these is a **destructive change on shared prod** requiring a **per-app anon-read audit across every sibling app** first. C found the drop low-risk *for psg-hub*, but **cannot assert it safe for all siblings from psg-hub alone**. ROADMAP line 24 already routes this to Phase 8. **Phase 6 must NOT drop them.**
- *Alternative (NOT recommended):* drop the obvious pure-wins now (`profiles`, `clients`, the 8 unread tables). Mixes a destructive prod-data change into the spine phase and pre-empts the audited Phase 8 effort.

### Secondary decisions (fold into 06-01 checkpoint, don't agonize)

- **D4 — MSO grant grain:** per-**shop** (multiple `shop_users` rows — today's working model) vs per-**client** (`shops.client_id` groups shops; one grant cascades). *Default: per-shop (matches deployed model); Phase 7 shop-switcher consumes it.*
- **D5 — `profiles.role` disposition:** *Recommended: vestigial-and-ignored-for-authz in Phase 6* (never trust it — anon-writable, default `'admin'`); formal drop deferred.

---

## 4. RECOMMENDED PLAN SPLIT (vertical, dependency-aware)

Three plans. **06-01 holds the S1 protocol + all forks** because those decisions reshape 06-02/06-03. 06-02 is the DB spine (gated on 06-01's fork outcomes). 06-03 is the app/edge enforcement layer.

### 06-01 — S1 Protocol + Forks + Migrations-as-Code foundation
**Goal:** Land the documented migration-safety + RLS-review protocol (the S1 gate), resolve the operator forks, and link the repo to the remote migration history — so 06-02 can apply customer DDL safely.
**Tasks (3):**
1. **`checkpoint:decision`** — surface D2 (claims, recommend no-hook subquery) → D1 (shared-mutate A1 vs isolate A3, conditional on D2) → D3 (defer the 26 policies), D4 (MSO grain), D5 (`profiles.role`). Document C's isolate dissent + why no-hook moots it.
2. **Migrations-as-code linkage (S1)** — `supabase init`, `supabase db pull` the 5 remote migrations into `supabase/migrations/`, `supabase link --project-ref gylkkzmcmbdftxieyabw`, commit. Stop ad-hoc MCP `apply_migration` for DDL; keep MCP for read-only inspection/advisors.
3. **Author the S4 RLS-review checklist + idempotency conventions** (in-repo doc) — per-table reader decision; `enable RLS` in same migration as `create table`; `to authenticated` never `public`/`anon`; wrap `(select auth.uid())`; helpers in `private` schema with `SET search_path`; run `get_advisors(security)` post-migration and diff against the known baseline (5 security-definer views + `spatial_ref_sys` pre-existing).
**Acceptance:** Each fork has a recorded operator decision. `supabase/migrations/` exists in-repo with the 5 baselined versions; `supabase link` succeeds. The S4 checklist is committed. **No DDL applied yet.**

### 06-02 — RBAC + RLS DB spine (role model + helpers + bootstrap)
**Goal:** Create the 3-role authorization model, helpers, default-deny clamp shapes, and the idempotent superadmin bootstrap — on the target chosen in 06-01.
**Tasks (3):**
1. **Create authz tables** (RLS-on, no anon/auth policy, default-deny): `app_user_roles(profile_id PK FK profiles, role CHECK IN ('customer','psg_internal','psg_superadmin'))` — **the first CHECK-constrained role vocabulary**; `security_profiles(profile_id PK, functions_jsonb)` (greenfield); `superadmin_emails(email PK)`.
2. **Create + harden helpers:** `current_user_role()`, `current_user_has_fn(text)` (shape: `superadmin OR (internal AND functions_jsonb ? key)`); add `SET search_path` to the 3 existing helpers — clears advisor `function_search_path_mutable`.
3. **Superadmin bootstrap (idempotent, email-allowlist):** seed `superadmin_emails` (Nick/Tina/Brian — **confirm Brian's email + Claire's disposition first**); reconcile existing users (`INSERT … ON CONFLICT DO UPDATE`); extend `handle_new_user` to grant `psg_superadmin` on signup when email matches (handles Brian's not-yet-existent account). Default new-signup role = `customer`.
**Acceptance:** authz tables exist RLS-on + no anon/auth policy. Nick + Tina resolve `psg_superadmin`. Smoke test confirms customer-clamp + ops-clamp deny `customer`/anon. `get_advisors(security)` adds no new ERROR/WARN.

### 06-03 — Middleware customer-id gate + app reconciliation
**Goal:** Enforce the role/shop check at the edge and reconcile the inherited (phantom-schema) app code onto the deployed model, so customer surfaces actually function.
**Tasks (2-3):**
1. **Customer-id-required gate** — reads `current_user_role()` + `user_shop_ids()` (one lightweight lookup, cache in request); redirects customers with no shop, allows internal/superadmin through. Target the **Next-16 proxy convention** OR a server-side `requireShop()` helper — confirm. UX/redirect gate; RLS stays the boundary.
2. **Reconcile app code → deployed model** — repoint psg-hub from phantom `shop_members(profile_id)` to `shop_users(user_id)`; fix the `reviews`→`review_items` collision (and `review_responses.review_item_id`); seed `shop_users` membership so `user_shop_ids()` is non-empty (today only Nick).
3. *(optional)* fix the `/ads` vs `/dashboard/ads` redirect bug.
**Acceptance:** unauth/no-shop user redirected; a seeded customer reaches their shop's data; internal/superadmin reaches cross-tenant. At least one previously-broken customer surface (ads or reviews) renders against the live DB.

---

## 5. RISKS & BOUNDARIES (what 06-01 must NOT touch)

- **DO NOT drop the 26 anon-open policies in Phase 6.** Destructive change on shared prod that may break sibling apps' anon reads; **cannot be asserted safe from psg-hub alone.** Deferred to the **M2 / Phase 8 PII gate** behind a per-app anon-read audit. Section 2's analysis is **not** license to drop them now.
- **DO NOT install a project-global access-token hook** unless the operator explicitly accepts the cross-app coupling (rewrites adv-portal + Claire's tokens; a throwing hook breaks project-wide login).
- **DO NOT touch the `sensitive` schema or other apps' tables** (`portal_users`, market-intelligence, `body_shops`/`survey_responses`). Phase 6 is **additive net-new tables + new helpers** only.
- **DO NOT rewrite existing rows in `shop_users`/`portal_users`/`profiles` in place.** Phase 6 **derives** initial `app_user_roles` from existing data; the three legacy tables stay.
- **`profile_id` / idempotency (S4):** new tables FK to `profiles(id)`; `profile_id` == `user_id` == `auth.uid()` (W4). Idempotent DDL: `create table if not exists`, `drop policy if exists` before `create policy`, `create or replace function`, `ON CONFLICT` on seeds, whole migration in one transaction.
- **Two orthogonal axes:** global identity (`customer`/`psg_internal`/`psg_superadmin` in `app_user_roles`) ≠ per-shop grain (`shop_users.role` owner/manager/viewer). Both survive; do not collapse. `customer` = "has `shop_users` rows"; internal/superadmin are shop-independent.
- **Read-only-during-PLAN honored:** A/B/C/E ground-truthed via read-only SELECT only; no DDL applied. Apply happens in `/paul:apply`.

---

## 6. RESIDUAL UNKNOWNS (APPLY-phase must confirm — NOT for PLAN)

1. **GoTrue / Dashboard Auth → Hooks config** — SQL only proves no hook *function* exists; confirm the Dashboard setting before assuming the field is clear (matters only if D2=(a)).
2. **Brian's exact email** for `superadmin_emails` (assumed `brian@phoenixsolutionsgroup.net`).
3. **Claire (`claire@static-solutions.com`) disposition** — external domain, `profiles.role='admin'`, no membership. Customer? Misconfigured internal? Stale test data? Operator call before seeding `app_user_roles`.
4. **Per-app anon-read audit** across all sibling PSG apps — required before the M2/Phase 8 drop of the 26 policies (out of Phase 6 scope).
5. **MSO grain (D4)** — per-shop vs per-client; confirm before finalizing the authz-table shape if Phase 7's switcher needs per-client.
6. **Next-16 middleware→proxy convention** — confirm whether the customer-id gate targets the proxy file or a server-side `requireShop()` helper (06-03 task 1).
7. **Tier source of truth (Phase 7 prep):** `subscriptions.tier` (0 rows, what code reads) vs `shops.subscription_tier` (`'essentials'`×6, populated). Phase 6 must not bless either in any role↔tier wiring; role and tier are orthogonal.
