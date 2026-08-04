# PSG-2637 Customer Dashboard PRD Map

Date: 2026-08-04
Owner: Ada
Status: implementation and QA handoff

## Bottom line

The customer analytics dashboard already has a direct-mail section wired into
`/dashboard/analytics`, and the underlying helper now covers most of the PRD
metrics. The remaining work is to verify the live screen against the PRD,
tighten any missing customer-facing details, run Tess QA, and then resubmit the
dashboard to Nick before anything is called production-ready.

## Sources checked

- `Reference.md`
- `docs/runbooks/graphify-codebase-graph.md`
- `docs/specs/003-direct-mail-dashboard-metrics.md`
- `apps/psg-hub/src/app/dashboard/analytics/page.tsx`
- `apps/psg-hub/src/components/analytics/direct-mail-panel.tsx`
- `apps/psg-hub/src/lib/analytics/direct-mail.ts`
- `apps/psg-hub/src/lib/analytics/__tests__/direct-mail.test.ts`

Graphify was used first to locate the customer dashboard route, analytics page,
and direct-mail helper before reading source files.

## PRD Mapping

| PRD requirement | Current implementation | Status |
| --- | --- | --- |
| Show direct-mail activity in the customer marketing dashboard | `/dashboard/analytics` renders `DirectMailPanel` with `getDirectMailMetrics` output. | Present, needs browser verification |
| Letters mailed in selected range | `activity.lettersMailed` is computed from send history and production rows. | Present |
| Letters mailed this month | `activity.lettersMailedMonthToDate` is displayed as "Letters mailed this month". | Present |
| Letters mailed year to date | `activity.lettersMailedYearToDate` is displayed as "Letters mailed this year". | Present |
| Letters mailed lifetime | `activity.lettersMailedLifetime` is displayed as "Letters mailed lifetime". | Present |
| Estimated referral reach | `estimatedReferralReach` uses the PRD multiplier of 3 and the panel labels it as an estimate. | Present |
| Households reached | `householdsReached` counts distinct history household keys and never renders the keys. | Present |
| Pieces sent by type | `piecesByType` is displayed as "Letters by campaign type" with friendly labels. | Present, verify labels against letter library |
| Recent send activity | `recentSendActivity` displays recent dates, pieces, and mailed counts. | Present |
| Response/outcome rate | `results.responseRate` is shown only when mined prior rows meet the minimum sample size. | Present |
| Responses and outcomes | `results.responsesOrOutcomes` is shown only when results are ready. | Present |
| Top-performing letter types | `results.bestPerformingPiece` is surfaced in the response-rate detail. | Partially present; table outcome counts need QA review |
| Monthly mail-result trend | Not currently charted as a monthly result trend. | Gap |
| Post-repair sales share | `postRepairSalesShare` uses repair-order dollars and package pricing when both are available, otherwise shows an honest empty state. | Present, needs source verification |
| Last updated | Panel shows last updated from activity, results, or latest sent date. | Present |
| Honest empty states | Panel shows empty states for no activity, missing history, insufficient sample size, and unavailable sales inputs. | Present |
| No raw recipient data | Helper returns aggregate-only metrics and test coverage checks that recipient/address/phone/email/household keys do not leak. | Present, needs browser QA |
| Multi-shop users only see assigned shops | Dashboard builds direct-mail scope from `getActiveShopContext` memberships before reading metrics. | Present, needs QA |
| Monthly report export section | Not verified in this heartbeat. | Gap |
| Nick approval before public/customer release | PSG-2637 still needs a fresh Nick review after implementation and Tess QA evidence. | Not complete |

## Required Workstreams

1. Engineering implementation pass:
   - Add or confirm the monthly result trend if enough mined prior data exists.
   - Confirm the campaign-type labels match the canonical letter library, not only the local fallback map.
   - Confirm whether the monthly report export uses the same direct-mail summary numbers, or add the export section.
   - Keep all values aggregate-only.

2. QA pass:
   - Browser-test `/dashboard/analytics` for a customer shop with direct-mail activity.
   - Confirm month, year-to-date, lifetime, estimated reach, households, pieces, recent activity, response states, and sales-share states.
   - Confirm another shop's raw or aggregate data is not visible to the wrong customer.
   - Confirm raw recipient fields never render.

3. Nick review:
   - After QA evidence is attached, resubmit the dashboard with a plain-language walkthrough and clear approve/request-changes path.
   - Do not claim production release until Nick approves and the production deployment is green.

## Current Release Decision

Do not mark this dashboard production-ready from PSG-2637 yet. The PRD map shows
that the core dashboard work is close, but monthly result trend, monthly report
export parity, QA evidence, Nick review, and production deployment confirmation
remain required gates.

Relevant SOPs checked: board communication standard, Graphify code-navigation rule, Nick review before customer-facing go-live.
