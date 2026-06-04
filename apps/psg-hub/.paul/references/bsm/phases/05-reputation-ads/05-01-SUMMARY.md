---
phase: 05-reputation-ads
plan: 01
status: complete
completed: 2026-04-19
---

# 05-01 Summary — Review ingestion (Google + Yelp)

## Shipped

**Schema (`supabase/migrations/003_reviews.sql`)**
- `review_platform` enum (google/yelp/facebook/carwise)
- `review_sources` table: per-shop platform config (shop_id, platform, external_account_id, credentials jsonb, active)
- `reviews` table: (shop_id, platform, external_id) unique for idempotency
- Indexes: `(shop_id, posted_at desc)`, `(shop_id, platform)`
- RLS via existing `get_user_shop_ids()` pattern
- `updated_at` trigger + `set_updated_at()` function

**Adapter library (`dashboard/src/lib/reviews/`)**
- `types.ts` — Review, ReviewSource, ReviewAdapter interface, AdapterConfigError, AdapterFetchError
- `yelp.ts` — Yelp Fusion v3 `/businesses/{id}/reviews` (max 3/call)
- `google.ts` — Places API Place Details with `reviews` field (max 5/place)
- `index.ts` — adapter registry with `getAdapter()` / `hasAdapter()`
- All files `import "server-only"` to prevent client leak

**API routes**
- `POST /api/reviews/ingest` — auth + membership check, queries active sources, fetches in parallel (Promise.all), upserts with ON CONFLICT DO NOTHING via service-role client. Returns `{ inserted, skipped, errors }`
- `GET /api/reviews/list` — auth-gated, RLS-scoped, filters by shop_id/platform/min_rating

**Service-role helper (`dashboard/src/lib/supabase/service.ts`)**
- Bypasses RLS for ingest; requires `SUPABASE_SERVICE_ROLE_KEY`

**UI**
- `/reviews` page (server component) — fetches reviews + shops, renders `ReviewsTable`
- `ReviewsTable` client component — shop/platform filters, Sync now button (useTransition), star rating, truncated body, platform badges, external source link, empty state
- Reviews link added to `(dashboard)/layout.tsx` sidebar

**Env**
- `.env.example` updated: `SUPABASE_SERVICE_ROLE_KEY`, `YELP_API_KEY`, `GOOGLE_PLACES_API_KEY`

## Verification

- `npm run build` — passes, `/reviews`, `/api/reviews/ingest`, `/api/reviews/list` all compiled
- `npm run lint` — 0 errors (1 pre-existing warning in supabase/middleware.ts unrelated)
- 18/18 static pages generated
- RLS policies written per existing pattern in `001_initial_schema.sql`

## Deferred (per plan boundaries)

- Facebook Graph + Carwise adapters → 05-01b (Facebook gating + Carwise has no public API, needs scraper approach)
- Automated cron scheduling → later (manual Sync now only for now)
- Per-shop OAuth token encryption → Phase 6
- AI response drafts → 05-02
- Response posting back to platforms → 05-02
- Paperclip reputation-monitor agent wiring → after 05-02
- Observability/logging instrumentation → not in plan scope (matches existing billing route pattern)

## Blockers requiring user action

1. **Supabase project** — no BSM project linked (`supabase projects list` shows none). Create one in psg org, then:
   ```
   supabase link --project-ref <new-bsm-ref>
   supabase db push
   ```
2. **Secrets to paste into `.env` (dashboard):**
   - `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → Settings → API)
   - `YELP_API_KEY` (https://docs.developer.yelp.com/docs/fusion-authentication)
   - `GOOGLE_PLACES_API_KEY` (enable Places API in Google Cloud Console)
3. **Vercel project** — no BSM project on Vercel. `vercel link` + env var push needed for production deploy.
4. **review_sources seeding** — per-shop records need external_account_id (GBP place_id / Yelp business ID) before ingest returns anything. Settings page UI for this → separate small plan.

## Next

**05-02** — AI review response generation (Claude Haiku drafts, tone-matched per platform, human approval gate before posting).
