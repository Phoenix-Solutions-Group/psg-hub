# External Integrations

Catalog of third-party services psg-hub talks to, where the code lives, and how
auth/secrets are configured. Keep this in sync when adding or changing an adapter.

> Secrets are configured in Vercel (env vars), documented by NAME only in
> `apps/psg-hub/.env.example`, and read server-side. Never commit secret values.

## Pipedrive (CRM) — read-only connection (PSG-423)

Status: **read-only connection test only**. No feature build yet (full CRM
integration deferred — see `.paul/PROJECT.md` "Pipedrive integration (deferred to
v2.0+)"). PSG-423 wires a safe probe to prove we can reach the account.

- Code: `src/lib/crm/pipedrive/`
  - `config.ts` — typed, env-based config loader (`loadPipedriveConfig`), domain
    normalization, and `presentPipedriveEnvKeys()` (NAMES only) for runtime
    discovery of the configured var names.
  - `client.ts` — minimal read-only client + `pingPipedrive()` (`GET /users/me`,
    best-effort deal count via `GET /deals?limit=1`). Transport is injected so
    tests never hit the live API.
  - `__tests__/pipedrive.test.ts` — unit tests (mock HTTP; live API never hit in CI).
- Route: `GET /api/ops/crm/pipedrive/ping` — superadmin-gated read-only probe.
  Returns `{ reachable: true, user, dealCount }` (green) or `{ reachable: false,
  reason }` (red). On `config_missing` it returns `checkedEnvNames` +
  `presentEnvNames` (PIPEDRIVE_* key NAMES present in the env, never values).

### Auth model

Personal API token, passed as an `api_token` **query param** against
`https://{companyDomain}.pipedrive.com/api/v1`. Both the token and the company
subdomain are required.

### Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `PIPEDRIVE_API_TOKEN` | yes | Personal API token (Settings → Personal preferences → API). Aliases accepted: `PIPEDRIVE_TOKEN`, `PIPEDRIVE_API_KEY`. |
| `PIPEDRIVE_COMPANY_DOMAIN` | yes | Account subdomain (`acme` for `acme.pipedrive.com`; a full host/URL is normalized). Aliases accepted: `PIPEDRIVE_DOMAIN`, `PIPEDRIVE_COMPANY`, `PIPEDRIVE_SUBDOMAIN`. |

**Exact Vercel var names (project `psg-digital/psg-hub`):** the CEO (Nick) added the
credentials to Vercel; the exact names were not assumed in code. The loader tolerates
the canonical names + the aliases above, and the ping route reports the actual
present `PIPEDRIVE_*` names (never values) so the exact configuration can be
confirmed against the deployed env without Vercel CLI access. **TODO (PSG-423):
record the confirmed names here once the ping route is run in the deployed env.**

### How to run the connection test

Deployed: authenticate as a `psg_superadmin` and `GET /api/ops/crm/pipedrive/ping`.
Green ⇒ token + domain reach the account (response carries the authenticated user +
company). The `presentEnvNames` field in a red `config_missing` response confirms
which `PIPEDRIVE_*` var names are actually set.
Catalog of third-party services the BSM app talks to, their env vars, and where the
adapter code lives. Keep secrets OUT of this file — names and procedures only.

## Invoiced.app (external billing) — PSG-422

Status: **read-only connection test only.** No mirror table, no webhook yet. The
`invoices` mirror + `/api/webhooks/invoiced` are anticipated in `PLANNING.md` but
deliberately NOT implemented here (spun out of planning PSG-420).

- **Auth:** HTTP Basic — the API key is the **username**, password is **empty**.
- **Environments:** sandbox (`https://api.sandbox.invoiced.com`, default, no spend)
  vs live (`https://api.invoiced.com`). Selected by `INVOICED_ENV` (`live` opts in;
  anything else stays sandbox).
- **Code:** `apps/psg-hub/src/lib/billing/invoiced/` — `config.ts` (env loader),
  `client.ts` (`pingInvoiced()` read-only probe, one shared circuit breaker like
  `stripe.ts`). Connection-test route: `GET /api/ops/admin/integrations/invoiced/ping`
  (superadmin-gated, no DB write, no audit row — nothing mutates).

### Env vars

| Var | Required | Notes |
| --- | --- | --- |
| `INVOICED_API_KEY` | yes | Invoiced REST API key (secret). **The exact name Nick set in Vercel (`psg-digital/psg-hub`) is UNCONFIRMED** — the agent could not run `vercel env ls`. The loader resolves the key from the first match of, in order: `INVOICED_API_KEY`, `INVOICED_SANDBOX_API_KEY`, `INVOICED_SECRET_KEY`, `INVOICED_KEY`. |
| `INVOICED_ENV` | no | `live` → live API; unset/other → sandbox (fail-safe, no spend). |

### Confirming the real Vercel var name (PSG-422 step 1)

Because the agent has no Vercel CLI/token, the deployed ping is the confirmation tool:
run `GET /api/ops/admin/integrations/invoiced/ping` as a superadmin against the
sandbox deploy. The JSON response includes `keySource` — the env var **name** the key
resolved from (never the value). Record that name here and in `.env.example`, then
prune `KEY_ENV_CANDIDATES` in `config.ts` to the single confirmed name.

Green result: `{ reachable: true, environment: "sandbox", keySource: "<name>",
httpStatus: 200, account: {...} }`. Red surfaces a reason (e.g. HTTP 401 → key
rejected; config error → naming the vars checked).

## Yext listings/reviews — PSG-1080

Status: **read-only export import path**. No live Yext API pull or secret-backed
adapter is active yet. This gives BSM a safe first-batch path once PSG has a Yext
export containing shop/entity mapping, listing accuracy/status, and review status.

- Code:
  - `src/lib/yext/import.ts` — validates a `source: "yext_export"` payload,
    normalizes listing status keys, summarizes listing accuracy/issues and review
    status, then upserts shop-scoped cache rows.
  - `src/lib/yext/status.ts` — shop-scoped status reader.
  - `POST /api/ops/yext/import` — `manage_companies` gated import route using the
    service-role client. Idempotent by `shop_id`; re-importing an export replaces
    the same shop's Yext mapping/cache rows.
  - `GET /api/shops/[shopId]/yext/status` — customer/session route with an explicit
    `shop_users` membership check before reading through RLS.
- Storage:
  - `yext_accounts` maps `shop_id` to `yext_entity_id` and optional
    `yext_account_id`; `api_key_ref` is a reference only and must never hold a
    secret value.
  - `yext_listings_cache` and `yext_reviews_cache` store the latest export payload
    plus summaries, with 30-day cache metadata.
- Access control: all three tables enable row-level security and allow reads only
  when `shop_id in user_shop_ids()`. No customer write policy exists; imports use
  service role behind the ops route.

### Import payload shape

```json
{
  "source": "yext_export",
  "synced_at": "2026-07-10T19:30:00.000Z",
  "shops": [
    {
      "shop_id": "00000000-0000-4000-8000-000000000000",
      "yext_account_id": "optional-account-id",
      "yext_entity_id": "required-yext-entity-id",
      "listings": [
        {
          "publisher": "Google",
          "listing_id": "optional-listing-id",
          "status": "Live - Synced",
          "accuracy": 92,
          "url": "https://example.com/listing",
          "issues": ["Phone mismatch"]
        }
      ],
      "reviews": {
        "average_rating": 4.6,
        "review_count": 128,
        "response_rate": 87,
        "unanswered_count": 3,
        "latest_review_at": "2026-07-09T12:00:00.000Z",
        "status": "healthy"
      }
    }
  ]
}
```

### Environment variables

Current export import path: **none required**.

Future live API adapter names, if approved later:

| Var | Required | Purpose |
| --- | --- | --- |
| `YEXT_API_KEY` | yes for live API pull only | Server-side Yext API credential. Never expose or log. |
| `YEXT_ACCOUNT_ID` | optional/account-dependent | Account identifier if the selected Yext endpoint requires an account-level id. |

## Stripe (billing of record)

Mirror logic in `src/lib/billing/stripe-mirror.ts`; webhook at `/api/webhooks/stripe`.
Keys: `STRIPE_SECRET_KEY`, price ids `STRIPE_{ESSENTIALS,GROWTH,PERFORMANCE}_PRICE_ID`.

## Lob.com (mail) — v1.3

Keys: `LOB_API_KEY` (test_* vs live_* gated by board gate G4), `LOB_WEBHOOK_SECRET`.
Webhook at `/api/webhooks/lob` (HMAC-SHA256 signature, fails closed).
