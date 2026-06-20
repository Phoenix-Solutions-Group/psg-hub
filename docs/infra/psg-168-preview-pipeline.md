# PSG-168 — BSM preview/staging deploy pipeline (seedable Supabase)

**Owner:** Ada (build). **Status:** build gated on board confirmation `b9332e8f`
(operator-only credential handoff). This runbook is the build plan so that on
**accept**, standing up a green preview + handing live-route QA to Tess is
mechanical — no design left to do at execution time.

> Scope note: this doc + `apps/psg-hub/supabase/seeds/bsm_live_route_qa.sql` are
> **build-prep artifacts**, written and grounded against the real route/schema
> but **not yet executed** (no non-prod seedable Supabase exists from the agent
> workspace — that is exactly the blocker PSG-168 escalates). They become
> verified work when applied against the preview env on the accept path (§5).

---

## 1. Why this exists

Every BSM live-route E2E QA needs three things **together**: a deployed app, real
auth sessions, and a **seedable Supabase that is NOT production**. We hit it on
[PSG-167](../../) (keyword-targets HTTP+auth E2E) and will hit it on every future
shop-scoped API route. It also satisfies the standing deploy mandate: prove the
`branch → deploy → env` pipeline works **before** promoting a BSM milestone to prod.

## 2. The verified gap (why no agent can self-provision this)

Checked end-to-end from the agent workspace:

| Need | Workspace reality | Verdict |
|------|-------------------|---------|
| Vercel preview deploy | No Vercel CLI, no `VERCEL_TOKEN`, no Vercel MCP; `gh` unauthenticated (push = artifact only) | operator-only |
| Faithful local/preview run | Route's `createServiceClient()` requires `SUPABASE_SERVICE_ROLE_KEY` | operator-only |
| Supabase service-role key | Supabase MCP can create branches but exposes **anon/publishable keys only** — no `service_role` getter | operator-only |
| Seed a non-prod DB | Only configured Supabase is **prod** `gylkkzmcmbdftxieyabw` — seeding prod is forbidden | blocked until a non-prod env exists |
| **Alt:** Cloudflare Workers | Cloudflare Workers MCP **is** connected + authenticated | agent-drivable deploy (still needs the one Supabase secret) |

So the only true human/operator inputs are **(1)** a Vercel deploy token scoped to
`psg-digital/psg-hub` and **(2)** a standing non-prod seedable Supabase preview env
with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` wired as Vercel **Preview**-scope vars. Everything else
is mine. This is the rule-#1 escalation carve-out (secret minting/injection).

## 3. Board outcomes → my next move

The decision is `request_confirmation b9332e8f`. Three branches:

- **Accept (creds provisioned)** → execute §4–§5 on Vercel. Default path.
- **Reject → "defer"** → park PSG-168 risk-accepted; [PSG-167](../../) stays
  closed-as-covered (its 4 residual cases are pure HTTP-status framing already
  covered by the 22/22 real-`GET`-handler unit suite + PSG-165 live DB QA). **Not**
  a BSM delivery blocker. These artifacts wait on the shelf, reusable as-is.
- **Reject → "Cloudflare"** → execute §4–§5 with the deploy target swapped to a
  Cloudflare Worker via the connected Workers MCP (still needs the one Supabase
  service-role secret; `@opennextjs/cloudflare` adapter; architecture deviation —
  flag to board before promoting anything built this way to prod).

The DB seed (§4) and verification gate (§5) are **identical across Vercel and
Cloudflare** — only the deploy host differs.

## 4. Build steps (accept path)

1. **Confirm the preview Supabase is non-prod.** Assert the project ref is **not**
   `gylkkzmcmbdftxieyabw` before any write. Never seed prod.
2. **Apply migrations** to the preview DB (`apps/psg-hub/supabase/migrations/`) so
   the schema matches main. (PSG-165 note: branch migration-replay can fail; if so,
   apply the verified schema slice for `clients/shops/campaigns/research_artifacts/shop_users`.)
3. **Create the QA auth user via the GoTrue Admin API** (pin the fixed UUID the
   seed uses), so password sign-in yields a real session:
   ```
   POST {SUPABASE_URL}/auth/v1/admin/users
     Authorization: Bearer {SERVICE_ROLE_KEY}
     { "id": "00000000-0000-4000-8000-000000168001",
       "email": "qa.bsm@psg.test", "password": "<pick a strong value, store in Vercel preview env as QA_BSM_PASSWORD>",
       "email_confirm": true }
   ```
4. **Seed DB fixtures** (idempotent, preview only):
   ```
   psql "$PREVIEW_DATABASE_URL" \
     -v qa_user_id="'00000000-0000-4000-8000-000000168001'" \
     -f apps/psg-hub/supabase/seeds/bsm_live_route_qa.sql
   ```
   The trailing verify query must return one row of all-`true`.
5. **Deploy the preview** (push branch → Vercel preview build, or Workers deploy)
   and confirm the deployment goes **green** with the three Preview-scope Supabase
   env vars resolved.

## 5. Verification gate → hand to Tess

Mint a session for `qa.bsm@psg.test` (password grant against the preview GoTrue),
then exercise the keyword-targets route. The seed makes all four PSG-167 residual
cases reproducible:

| Case | Request | Expect |
|------|---------|--------|
| 401 | `GET /api/shops/<tracy>/keyword-targets` with **no** `Authorization` | `401 Unauthorized` |
| 403 | authenticated as QA user → `GET /api/shops/<wallace>/keyword-targets` (not a member) | `403 Forbidden` (distinct, not RLS-empty) |
| 400 | authenticated → `GET /api/shops/not-a-uuid/keyword-targets` | `400 Bad request` |
| 200 + filter | authenticated → `GET /api/shops/<tracy>/keyword-targets?topic=bumper` | `200`, exactly the 2 `bumper` keywords, **never** `wallace exclusive keyword` |

Shop UUIDs: tracy `…168501`, wallace `…168502`, tedesco `…168503` (200 + `[]`).

When all four pass on the live preview, reassign the live-route QA tickets
(PSG-167 closeout) to **Tess** with this table as the test plan, and record the
green preview URL on PSG-168.

## 6. Definition of done

- [ ] Preview env confirmed non-prod; migrations applied.
- [ ] QA user created; seed applied; verify query all-`true`.
- [ ] Preview deploy green with Preview-scope Supabase env resolved.
- [ ] All four §5 cases pass live; Tess signed off.
- [ ] `branch → deploy → env` pipeline proven (satisfies the pre-prod deploy mandate).
