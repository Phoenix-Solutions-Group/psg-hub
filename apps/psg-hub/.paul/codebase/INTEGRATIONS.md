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

## Stripe (billing of record)

Mirror logic in `src/lib/billing/stripe-mirror.ts`; webhook at `/api/webhooks/stripe`.
Keys: `STRIPE_SECRET_KEY`, price ids `STRIPE_{ESSENTIALS,GROWTH,PERFORMANCE}_PRICE_ID`.

## Lob.com (mail) — v1.3

Keys: `LOB_API_KEY` (test_* vs live_* gated by board gate G4), `LOB_WEBHOOK_SECRET`.
Webhook at `/api/webhooks/lob` (HMAC-SHA256 signature, fails closed).
