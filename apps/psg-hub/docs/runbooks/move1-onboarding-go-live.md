# Move 1 go-live runbook — deal-won → onboarding board auto-create

**What this turns on (plain English):** when a sales deal is marked **Won** in Pipedrive,
our system automatically creates that client's onboarding project board (phases + tasks)
so delivery starts on day one instead of someone building it by hand.

Owner: Ada (Chief Developer). Related issues: PSG-584 (build), PSG-591 (this helper route +
security review), PSG-586 (go-live), PSG-585 (QA).

The switch-on is done through a locked, single-purpose ops route we built so **no human has
to run a raw command-line script and no secret token is ever exposed to a person**:

    POST /api/ops/pipedrive/onboarding-setup   (Bearer: ONBOARDING_SETUP_SECRET)

## Why this can only run against PRODUCTION (not a preview)

1. Every preview deployment 500s at the front door: middleware calls Supabase
   `createServerClient(NEXT_PUBLIC_SUPABASE_URL!, ANON_KEY!)`, and those two env vars are
   configured **Production-only**. Missing on Preview → `MIDDLEWARE_INVOCATION_FAILED` on
   *every* route, including this one. (This also blocks preview-based QA generally — see the
   note at the bottom.)
2. The `register` step points Pipedrive's webhook at the **production** webhook handler
   (`${NEXT_PUBLIC_APP_URL}/api/webhooks/pipedrive`). Registering before that handler is live
   in production would point Pipedrive at a dead URL and lose deal-won events.

**Therefore the sequence is: PSG-585 (Tess QA) → merge `feat/psg-584-deal-won-projects` to
`main` → production redeploys with the route + webhook handler → run the steps below.**

## Preconditions (all already true unless noted)

- Vercel project: `psg-digital/psg-hub`, production branch = `main`.
- Prod env set: `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_COMPANY_DOMAIN`, `PIPEDRIVE_WEBHOOK_USER`,
  `PIPEDRIVE_WEBHOOK_PASS`, `PIPEDRIVE_SALES_PIPELINE_ID`, `NEXT_PUBLIC_APP_URL`,
  `ONBOARDING_SETUP_SECRET`. (Verified present 2026-07-06.)
- The route + webhook handler are live on production (i.e. `feat/psg-584` merged to `main`).

## Step 0 — rotate the trigger secret to a value we know

`ONBOARDING_SETUP_SECRET` is stored encrypted/sensitive and cannot be read back. To call the
route, rotate it to a freshly generated value, then redeploy so production picks it up.

    SECRET=$(openssl rand -hex 32)
    printf '%s' "$SECRET" | npx vercel env rm ONBOARDING_SETUP_SECRET production --yes --token "$VERCEL_TOKEN"
    printf '%s' "$SECRET" | npx vercel env add ONBOARDING_SETUP_SECRET production --token "$VERCEL_TOKEN"
    # redeploy production so the new secret is in the running function's env
    npx vercel redeploy <prod-deployment-url> --token "$VERCEL_TOKEN"

Keep `$SECRET` only in this shell; do not paste it into any issue comment.

## Step 1 — discover the board + starting phase (read-only, no side effects)

    PROD=https://<prod-host>            # value of NEXT_PUBLIC_APP_URL
    curl -s -X POST "$PROD/api/ops/pipedrive/onboarding-setup" \
      -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
      -d '{"action":"discover"}'
    # → { ok:true, boards:[{id,name}, ...] }
    # pick the onboarding/delivery board id, then list its phases:
    curl -s -X POST "$PROD/api/ops/pipedrive/onboarding-setup" \
      -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
      -d '{"action":"discover","boardId":<BOARD_ID>}'
    # → { ok:true, boards:[...], phases:[{id,name,board_id}, ...] }  → pick starting phase id

## Step 2 — wire the discovered ids into production env

    printf '%s' "<BOARD_ID>" | npx vercel env add PIPEDRIVE_ONBOARDING_BOARD_ID production --token "$VERCEL_TOKEN"
    printf '%s' "<PHASE_ID>" | npx vercel env add PIPEDRIVE_ONBOARDING_PHASE_ID production --token "$VERCEL_TOKEN"
    # redeploy prod so the deal-won handler reads them

## Step 3 — register the deal-won webhook (idempotent)

    curl -s -X POST "$PROD/api/ops/pipedrive/onboarding-setup" \
      -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
      -d '{"action":"register","boardId":<BOARD_ID>,"phaseId":<PHASE_ID>}'
    # → { ok:true, alreadyRegistered:false, id:<hookId> }   (or alreadyRegistered:true on re-run)

Running Step 3 twice never creates a duplicate: the route first lists existing webhooks and
reuses any already pointed at `${NEXT_PUBLIC_APP_URL}/api/webhooks/pipedrive`.

## Step 4 — verify go-live

- Mark a **test** deal Won in the sales pipeline (`PIPEDRIVE_SALES_PIPELINE_ID`).
- Confirm a new onboarding project board appears in Pipedrive with the template phases/tasks.
- Confirm no secret/token/URL appears in any response body or Vercel function log.

## Security properties of the route (reviewed by Ada, PSG-591, 2026-07-06 — PASS)

- Auth is checked **before any secret is read**: timing-safe (`node:crypto timingSafeEqual`)
  Bearer compare against `ONBOARDING_SETUP_SECRET`; unset secret = locked (401).
- The Pipedrive token lives **only in the query string** of outbound calls, never in logs.
- Thrown errors carry only `method /path → HTTP status` — never the URL (which carries the
  token) or the webhook password; the route additionally scrubs URLs/`api_token=` from any
  surfaced `detail`. Verified by tests (11/11 green).

## Known issue to fix separately (not part of Move 1)

Preview deployments are unusable because middleware hard-crashes when the Supabase env vars
are absent (they are Production-only). Recommend: (a) make `updateSession` fail-open (skip
session refresh) when Supabase env is missing, and (b) add the Supabase Preview env vars, so
QA can validate on preview URLs. Track as a separate ticket (auth-touching → security review).
