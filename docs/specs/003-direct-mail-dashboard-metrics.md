---
title: "BSM Customer Dashboard - Direct-Mail Activity and Results Metrics"
status: "draft"
issue: "PSG-1382"
owner: "Ada (Chief Developer)"
date: "2026-07-13"
---

# BSM customer dashboard: direct-mail activity and results metrics

## Bottom line

The BSM customer dashboard should show direct-mail performance in the same
customer-facing marketing area as digital marketing, so a shop owner can answer:
"What did PSG mail for me, how much activity happened, and what results did it
produce?"

The first customer-facing location is:

- `/dashboard/shop/[shopId]/marketing` once the shop-scoped marketing route is
  added.
- The existing analytics dashboard can link to it from `/dashboard/analytics`
  while that route remains the main customer marketing surface.
- Monthly report export should include the same direct-mail summary section after
  the metrics API is live.

This surface must show shop-level totals and trends only. It must not show raw
repair-customer names, street addresses, phone numbers, emails, or individual
recipient rows.

## Customer-facing panels

### 1. Direct-mail activity

Purpose: show the volume of work PSG completed for the shop.

Metrics:

| Metric | Plain-English label | Primary source | Freshness |
| --- | --- | --- | --- |
| `letters_mailed` | Letters mailed | `mail_send_history` when full send history is imported; `production_documents` / `mail_vendor_jobs` for new production runs | Daily after import or production sync |
| `letters_mailed_month` | Letters mailed this month | Same as `letters_mailed`, filtered to the current calendar month | Daily after import or production sync |
| `letters_mailed_ytd` | Letters mailed year to date | Same as `letters_mailed`, filtered to the current calendar year | Daily after import or production sync |
| `letters_mailed_lifetime` | Letters mailed lifetime | Same as `letters_mailed`, unbounded for the authorized shop scope | Daily after import or production sync |
| `estimated_referral_reach` | Estimated referral reach | `letters_mailed_* * 3`, clearly labeled as an estimate based on Nick's assumption that each recipient tells three people | Daily after import or production sync |
| `households_reached` | Households reached | Distinct `household_key` from `mail_send_history`; no raw address display | Daily after import or production sync |
| `pieces_by_type` | Pieces sent by type | `piece_code` / `piece_variant`, joined to `docs/ops/mail/letter-library.json` labels | Daily after import or production sync |
| `recent_send_activity` | Recent mail activity | Date-bucketed sends by shop and piece type | Daily after import or production sync |

Display notes:

- Default date range: trailing 30 days for recent activity, with separate cards
  for month-to-date, year-to-date, and lifetime letter counts.
- Estimated referral reach must be presented as an estimate, not a verified
  audience count: `letters mailed * 3 people told`.
- Multi-shop users may view all assigned shops only as aggregated totals; per-shop
  rows remain shop-scoped.
- Use friendly piece labels from the numbered letter library, not internal codes
  alone.

### 2. Direct-mail results

Purpose: show whether mailed pieces are connected to business outcomes.

Metrics:

| Metric | Plain-English label | Primary source | Freshness |
| --- | --- | --- | --- |
| `response_rate` | Response or outcome rate | `mail_send_priors` / mined send-history outcomes when full send history is available | Recomputed after send-history import and scheduled mining |
| `responses_or_outcomes` | Responses and outcomes | Positive outcomes from survey returns, referrals, repeat work, or follow-up repair orders, as defined in `apps/psg-hub/src/lib/ops/mail/priors.ts` | Recomputed after outcome imports |
| `post_repair_sales_share` | Post-repair sales share | `repair_orders.repair_amount_cents` for post-repair orders divided by the shop's overall package revenue from `company_programs.unit_price_cents * quantity` or Invoiced billing data when available | Monthly after repair/order and billing sync |
| `top_letter_types` | Top-performing letter types | `mail_send_priors` joined to the letter library | Recomputed after mining |
| `trend_by_month` | Monthly mail-result trend | Monthly send totals joined to mined outcomes | Monthly after mining |

Display notes:

- Response rate should be shown only when the denominator is meaningful. If there
  are too few sends, show "Not enough mailed pieces yet" instead of a misleading
  percentage.
- Post-repair sales share should be shown only when both sides are honestly
  sourced: total post-repair sales dollars and package/billing dollars. If either
  side is unavailable, show a plain empty state explaining which source is waiting.
- Ratios must be computed from raw counts for the selected scope, not averaged
  across shops or months.
- Results should carry a "last updated" timestamp and a short empty state when
  historical send history has not landed yet.

## Nick review additions for PSG-1389

Nick reviewed the first dashboard draft on 2026-07-14 and did not approve it for
customer release until these metrics are also shown:

| Metric | Definition | Display rule |
| --- | --- | --- |
| `post_repair_sales_share` | `post_repair_repair_amount_cents / overall_shop_sales_cents`, where post-repair dollars come from completed repair order totals and overall shop sales come from the shop's package prices or Invoiced billing records. | Show as a percentage only when both numerator and denominator are sourced. Show the dollar inputs in supporting text if available. |
| `letters_mailed_month` | Count of letters produced/mailed for the selected shop scope in the current calendar month. | Show as a primary activity card. |
| `letters_mailed_ytd` | Count of letters produced/mailed for the selected shop scope from January 1 through today. | Show as a primary activity card. |
| `letters_mailed_lifetime` | Count of all known letters produced/mailed for the selected shop scope. | Show as a primary activity card. |
| `estimated_referral_reach` | `letters_mailed * 3`, based on Nick's requested assumption that one person tells three people about the letter. | Show as an estimated reach metric and label the assumption clearly. Provide month, year-to-date, and lifetime reach if space allows. |

Implementation notes:

- The current analytics helper reads a caller-provided date range, so it can
  already support trailing-window counts. It needs either multiple range reads or
  lifetime/month/year rollups so the dashboard can show all requested time spans.
- `repair_orders.repair_amount_cents` is the canonical repair-dollar source. It
  is nullable, so missing amounts must not be treated as zero.
- `company_programs.unit_price_cents` is the current package-price source in the
  app schema. The captured Invoiced tables include customer/product billing cache
  data, but final implementation must verify which billing table is authoritative
  before exposing a customer-facing sales-share percentage.
- No raw repair-customer or recipient data may be returned to the dashboard.

## Data sources and current gap

The current codebase already has the core direct-mail foundation:

- `docs/specs/002-mail-send-history-w0/spec.md` defines the send-history,
  suppression, prior-mining, and letter-library architecture.
- `apps/psg-hub/src/lib/ops/mail/types.ts` defines the PII-minimized send-history
  import result.
- `apps/psg-hub/src/lib/ops/mail/priors.ts` defines the pure result-mining logic
  for outcome rate by segment, piece, and A/B arm.
- `docs/ops/mail/letter-library.json` and `docs/ops/mail/letter-library.md`
  define customer-friendly labels for legacy piece codes.
- `docs/ops/mail/priors/` is the documented human-readable output location for
  mined direct-mail priors.

Known data gap:

- The full per-recipient FileMaker send log is still the gating historical data
  source. Without it, the dashboard can show new production sends and sample
  history, but it cannot honestly show complete historical response rates or
  top-performing letter types.

Implementation posture:

- Build the dashboard API to return partial-but-honest states: activity metrics
  when sends exist; result metrics only after `mail_send_priors` has enough mined
  rows.
- Do not invent response rates from production counts alone.

## Privacy boundary

Allowed in the customer dashboard:

- Shop-level totals.
- Month/day trends.
- Piece families and letter-type labels.
- Aggregated results, with small-sample suppression.

Not allowed in the customer dashboard:

- Repair-customer names.
- Street addresses.
- Phone numbers or email addresses.
- Raw recipient lists.
- Household keys or recipient hashes.
- Any single recipient's mailing or outcome history.

The implementation must use shop-scoped access controls already used by the
dashboard. Customer users should only see shops assigned to their account.

## Engineering split

1. Implement the shop-scoped direct-mail metrics API and aggregation helpers.
   Owner: engineering.
   Acceptance: returns activity metrics from available send/production rows,
   returns honest empty states for unavailable result metrics, and never returns
   raw recipient data.

2. Add the customer-facing marketing dashboard panel and monthly report section.
   Owner: engineering with UX review.
   Acceptance: shows activity, month-to-date/year-to-date/lifetime mailed counts,
   estimated referral reach, post-repair sales share when honestly sourced,
   results, top pieces, recent activity, empty states, and last-updated timestamps
   in plain customer language.

3. Verify privacy and behavior.
   Owner: QA.
   Acceptance: confirms customer users cannot see another shop's data, raw
   recipient fields never render, small-sample results are hidden, and the monthly
   report export matches the dashboard numbers.

4. Get Nick's approval before anything public or customer-facing goes live.
   Owner: Nick.
   Acceptance: Nick reviews the draft dashboard/report behavior and approves or
   requests changes before release.

## Source notes

Repository sources reviewed for this spec:

- `Reference.md`
- `docs/runbooks/graphify-codebase-graph.md`
- `apps/psg-hub/README.md`
- `docs/specs/002-mail-send-history-w0/spec.md`
- `docs/strategy/direct-mail-letter-design-and-variability.md`
- `apps/psg-hub/src/lib/ops/mail/types.ts`
- `apps/psg-hub/src/lib/ops/mail/priors.ts`
- `apps/psg-hub/src/app/dashboard/analytics/page.tsx`
- `apps/psg-hub/src/lib/ops/reports/registry.ts`

The PSG knowledge-base environment variables are present in this runtime, but no
callable gbrain tool or MCP resource was exposed to this session. I therefore
treated the checked-in PSG planning and direct-mail documents above as the
available company memory for this heartbeat.
