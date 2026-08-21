# 007 — Customer Google Ads page: accurate details + safe request boundaries

- Issue: PSG-3038 (parent PSG-3034, ancestor PSG-2947)
- Owner: Drew, Paid Media Director
- Date: 2026-08-20 (§8 decisions written in 2026-08-20, PSG-3044 → PSG-3048)
- Consumers: Uma (design, PSG-3039), Ada (engineering, PSG-3040), Tess (verification, PSG-3041)
- Status: requirements — not a design, not an implementation plan
- **Product decisions: settled.** All ten open questions were ruled on by Steve. §8 is
  decided text, not options. Design and build proceed against it.

---

## 0. Bottom line for a shop owner

A body-shop owner opens the Ads page to answer four questions:

1. **What did I spend?**
2. **What did I get for it?**
3. **Is anything broken?**
4. **How do I ask PSG to change something?**

Nothing on this page may change a live Google Ads campaign or move a dollar of ad
spend. Everything a customer does here is a **request**. A PSG human makes the actual
change somewhere else.

> **Blocker found while writing this spec:** that rule is not true in production today.
> Three API endpoints let a customer create, enable, pause, or delete a real Google Ads
> campaign with no PSG review. No shipped page has a button for them, but the endpoints
> are live and callable. See **§1a**. This must be fixed before PSG-3034 goes back to Nick.

---

## 1. What is actually live today (verified, not assumed)

This section exists because the PSG-2947 review checklist described a page that does
not exist in production. Evidence gathered 2026-08-20:

| Claim | Verified state | Evidence |
| --- | --- | --- |
| The live Ads page shows campaign details, a change-request form, a before-submit summary, and PSG review status | **False.** The live page is a heading plus a linked-accounts table (Customer ID / Status / Linked / Last error / Disconnect). | `origin/main` @ `d8146f75` → `apps/psg-hub/src/app/dashboard/ads/page.tsx` renders only `<AccountsTable>`; Nick's screenshot on PSG-3034 matches it exactly. |
| A richer Ads page exists | **True, but unmerged.** Metric tiles, best-performing campaigns, recent changes, an "Ask PSG for help" form, request history, and report downloads exist only on the unmerged branch `feat/psg-790-tedesco-lead-endpoint` (359 commits ahead of `main`; `main` is 47 commits ahead of it). | `git rev-list --left-right --count main...HEAD` → `47 359`; commits `065e696c`, `225b9e90` not ancestors of `main`. |
| The **request form** changes a live campaign | **False.** It writes one row to `google_ads_customer_requests` and nothing else. The migration comment says so explicitly, the route emits `executesGoogleAdsChange: false`, and a customer literally cannot send a `status` field. | `apps/psg-hub/src/app/api/shops/[shopId]/google-ads/requests/route.ts`; `supabase/migrations/20260717000000_google_ads_customer_requests.sql:5` |
| **No customer-reachable route can change a live campaign** | **FALSE — see §1a. Three live-mutation endpoints are reachable by a customer today.** | Verified on `origin/main`, first-hand. |
| An ops-only live-mutation capability exists | **True.** `apps/psg-ads-mutations` (Python) performs real Google Ads writes, invoked from psg-hub only through `/api/ads-mutations/dry-run` and `/api/ads-mutations/execute`, behind `requireOpsFn("ads_mutations")` with a registry, required target ID, high-risk board-approval UUID gate, and audit logging. This path is correct and is **not** the problem. | `apps/psg-hub/src/lib/ads-mutations/governance.ts`; `apps/psg-ads-mutations/README.md` "Safety rules (non-negotiable)" |

### 1a. BLOCKER — a customer can change a live Google Ads campaign today

This is the direct answer to the question PSG-3034 asks Nick to approve, and the answer
is not the one the review assumed.

Three API endpoints in production are gated **only** on: a logged-in session, the
Performance plan, and a `shop_users` role of `owner` or `manager` — that is *the body
shop owner*, not PSG staff. Each one calls the real Google Ads API:

| Endpoint | Who can call it | What it does at Google |
| --- | --- | --- |
| `POST /api/ads/google/campaigns` | customer `owner` or `manager` | `customer.campaignBudgets.create` + `customer.campaigns.create` — **creates a real campaign and budget.** Mitigating: created `status: 3` (PAUSED), so it does not spend on creation. |
| `PUT /api/ads/google/campaigns/[id]` | customer `owner` or `manager`; `paused → enabled` requires `owner` | `customer.campaigns.update` — **pause, remove, or enable.** A customer owner enabling a campaign starts real ad spend with no PSG review. |
| `DELETE /api/ads/google/campaigns/[id]` | customer `owner` | `customer.campaigns.update` to `status: 4` (REMOVED) — **ends a live campaign.** |

Verified in `apps/psg-hub/src/lib/google-ads/campaigns.ts` (`createCampaign` :39, `updateCampaign` :133,
both wrapped in `withAdsRateLimit(..., "MUTATE", ...)`) and the route role gates at
`campaigns/route.ts:110-119` and `campaigns/[id]/route.ts:96-115, :225`.

**Why this hasn't caused an incident yet:** the UI that drove these routes
(`campaigns-section.tsx`, `create-campaign-modal.tsx`, `campaign-detail-modal.tsx`) is
orphaned — nothing imports `CampaignsSection`, so no shipped page renders the buttons.
But App Router registers the routes regardless. They are callable right now by anyone
with a session, the tier, and an owner/manager role. **Absence of a button is not a
security control.**

**Related defect:** `campaigns/[id]/route.ts:148` always passes `budgetResourceName: null`,
so the budget branch of `updateCampaign` can never run. A budget edit through that route
updates our database row but **not Google** — the hub would then display a daily budget
that does not match the live account. Silent data divergence about a customer's spending.

**Required before PSG-3034 can go back to Nick:** these three endpoints must be removed,
or re-gated behind `requireOpsFn("ads_mutations")` so they are PSG-staff-only like every
other live-change path. Owner: Ada. Verification: Tess (PSG-3041) must prove it by test,
not inspection.

### 1b. Second defect — cross-client account number on a demo shop

**The Riverside Collision demo shop displays another client's real Google Ads account
number.** The screenshot shows customer ID `6048611995` as "Linked" on Riverside's Ads
page. That ID is **Wallace Collision's real production Google Ads account** — it appears
throughout `apps/psg-ads-mutations/ops/wallace/` as the live mutation target.

Why this matters: one client's account identifier is visible on another client's page,
and if a demo or preview action ever reached the mutation path it would be pointed at a
real, spending account. This must be cleaned up and re-verified before anyone reviews
this page again. Owner: Ada (PSG-3040) to remediate, Tess (PSG-3041) to confirm no
cross-shop account rows remain.

### 1c. Third defect — the customer request API accepts any shop role

`requireShopMember` on `shops/[shopId]/google-ads/requests` checks only that a
`shop_users` row exists. A `viewer` — the read-only role — can submit budget and campaign
change requests. Low severity (it creates a request, not a change) but it should match
the intent: requests come from `owner` or `manager`.

---

## 2. Field list — what a shop owner sees, where it comes from, what it means

Every field below must carry the plain-English meaning in the UI, not just the label.
"Source" is the system of record. Anything marked **PSG-authored** does not exist in the
data today and needs a place to live (see the settled decisions in §8).

### 2.1 Page-level

| Field | Source | What the owner is told |
| --- | --- | --- |
| Numbers current as of | `metrics_synced_at` / latest snapshot `synced_at` | "These numbers were last updated from Google on <date, time>." |
| Reporting window | Fixed 30-day trailing window ending today (**D9**) | Print the real dates in words: "Everything below covers **Jul 21 – Aug 20**." Never make the customer work out what "last 30 days" means. |
| Settling notice | Derived (always shown) | "The last 3 days are still filling in. Google keeps counting leads for up to 30 days after a click, so recent numbers usually go **up**, not down." The **most recent 3 days must be visibly marked** as still filling in (**D9**). |
| Response time promise | Fixed copy (**D5**) | Verbatim: "We'll confirm we've got your request within **one business day**, and give you an answer within **two**." The page must state that this counts **business days only**. |
| Connection health | `google_ads_accounts.status` | See §5 states. |

The settling notice is not optional. Conversion lag and same-day incompleteness are the
single biggest source of "your report is wrong" arguments with SMB clients. State it
before the customer finds it.

**Hidden accounts may not hide spend (D1).** Only the PSG-designated primary account's
numbers are shown. If a non-primary linked account carries real spend, that raises an
internal flag to the account manager — it must never silently disappear from the
customer's totals.

### 2.2 The five headline numbers

| Field | Source | Plain-English meaning | Accuracy rule |
| --- | --- | --- | --- |
| **Spend** | `analytics_snapshots` `metrics.spend`, summed over window | "What Google charged you for ads in the last 30 days." | Must say **ad spend only — does not include PSG's management fee.** |
| **Leads** | `metrics.conversions` | "People who called, filled in a form, or asked for an estimate because of an ad." | Two gates. (1) **D8:** if the shop has no defined lead definition, show **"not set up yet"** — never a number. (2) Otherwise show only when conversion tracking is verified; if not, show `Unconfirmed` + the reason. Already partly implemented in `buildGoogleAdsDashboard`. |
| **Cost per lead** | Spend ÷ Leads | "What each lead cost you." | Same two gates as Leads (**D8** first). Never compute from an undefined or unverified lead. |
| **Clicks** | `metrics.clicks` | "People who clicked your ad and landed on your site." | — |
| **Impressions** | `metrics.impressions` | "How many times your ad was shown." Must add: "This is visibility, not customers." | Never present as a success metric on its own. |

**Trend text** ("Up 12% vs prior period") compares to the immediately prior 30 days.
Suppress the trend entirely whenever the metric is unconfirmed — this is already the
behavior and must be preserved.

### 2.3 Per-campaign fields

| Field | Source | Plain-English meaning | Accuracy rule |
| --- | --- | --- | --- |
| Campaign name | `google_ads_campaigns.name` | The Google Ads name, e.g. "Collision Repair Search". | Show as-is. |
| What it's for | **PSG-authored** one-liner, written and approved by the account manager (**D7**) | "Brings in collision repair jobs from people searching in your area." | Required. A raw Google campaign name is meaningless to an owner. An AI draft is allowed as a starting point but nothing publishes until the account manager approves it. **If there is no approved description, the campaign still appears** and this cell reads **"Description coming — ask your account manager"** — never hide a campaign the customer is paying for. |
| Status | `google_ads_campaigns.status` | Translate: `enabled` → **Running**, `paused` → **Paused by PSG**, `removed` → **Ended**. | **Defect:** current code renders the raw enum in a badge. Never show `enabled`/`removed` to a customer. |
| **Monthly budget — the headline number** (**D6**) | Derived (`daily × 30.4`) | "About **$X per month** at this setting." | **This is the big number on the campaign card.** Owners think in months, not days. Label as approximate. |
| Daily budget — supporting detail (**D6**) | `daily_budget_micros ÷ 1,000,000` | "That works out to about $Y a day." | Shown **beneath** the monthly figure, smaller. Must be accompanied by: "Google can spend up to twice this on a busy day and less on a slow one, but it will not exceed <monthly total> in a month." This is real Google behavior and owners call about it. Leading with the daily number invites "why did you spend $94 yesterday when I said $50?" every month. |
| Spend this window | Campaign `metrics.cost_micros` | "What this campaign cost in the last 30 days." | **Defect:** the campaign-level `metrics` blob carries no window label and comes from a different source than the headline Spend tile. The two can disagree. Both must be labelled with the same explicit window, or the campaign card must be driven from the same snapshot source. |
| Leads this window | Campaign `metrics.conversions` | "Leads this campaign brought in." | Same two gates as the Leads tile — **D8** first: no lead definition → "not set up yet", not a number. |
| Clicks this window | Campaign `metrics.clicks` | "Clicks on this campaign's ads." | — |
| Where ads show | **PSG-authored** service area summary | "Riverside plus 15 miles." | Required for the "change my area" request to make sense. |
| What counts as a lead | **PSG-authored** conversion-action list, owned by the Tracking & Attribution Analyst (**D8**) | "Phone calls over 60 seconds, estimate form submissions." | Required. **If it is not defined for this shop, show "not set up yet" here and show no Leads number anywhere on the page.** A blank is honest; a number we cannot defend in front of a customer is not. |

### 2.4 Ranking rule for "Best-performing"

Current code sorts by conversions, then clicks. **When conversion tracking is
unverified, do not call anything "best-performing"** — that is an unsupported claim about
results. Rule:

- Tracking verified → heading "Best-performing campaigns", rank by leads, tie-break clicks.
- Tracking not verified → heading "Most active campaigns", rank by clicks, and show the
  unconfirmed note.

### 2.5 Recent changes

Source: PSG change log. Each entry: plain title + date. Wording must always attribute the
change to PSG — "PSG added collision repair search terms", never "Your campaign was
updated". The customer must never be able to read this list and think they made a change.

### 2.6 Reports

Source: `google_ads_optimization_audit_reports`. Fields: title, period month, published
date, download link. Only PSG-published, reviewed reports appear. A report in review is
described as pending — never listed with a broken link.

### 2.7 Fields that must NOT be shown to a customer

- Raw Google Ads error strings (`google_ads_accounts.last_error`) — may contain internal
  detail. Show a safe category instead (§5.6).
- Other shops' account identifiers (§1a).
- Search terms / query reports — can contain personal information typed by consumers.
- Keyword-level bids, Quality Score, impression share, bidding strategy internals,
  match types, negative keyword lists. These are easy to misread and generate
  "why is my Quality Score 6" conversations that cost more than they're worth.
- Anything from an account the shop does not own.

---

## 3. Request types — what a customer may ask for

Every one of these is a **request**. None of them changes anything on submission.

Required on **every** request, regardless of type:
- Which campaign (or explicitly "not about a specific campaign")
- A plain description, minimum 10 characters (already enforced)
- Requester identity + timestamp (captured server-side)
- The confirmation checkbox from §4

| # | Request | Required inputs | What the customer is warned about |
| --- | --- | --- | --- |
| R1 | **Change my budget** | Campaign; current budget (prefilled, read-only, **monthly leading per D6**); requested new budget; reason; when they want it | "Big budget swings restart Google's learning and results usually dip for 1–2 weeks. PSG will tell you if that applies." |
| R2 | **Pause or restart a campaign** | Campaign; pause or restart; reason; date; if pausing, until-when or "until I say otherwise" | "Pausing loses the history Google uses to find customers. Restarting is not instant." |
| R3 | **Talk to us about a new campaign** (**D10** — this is the button label) | Service; the offer/message; area to cover; start and end date; budget guidance; landing page; phone number | "New campaigns usually change your monthly scope and price, so your account manager will pick this up with you directly. PSG will confirm cost before anything starts." |
| R4 | **Change what an ad says** | Campaign; what's wrong; the exact new wording; why | "Google reviews new ad text, usually about one business day. Claims have to be ones you can back up." |
| R5 | **Change where ads show** | Campaign; current area (prefilled); requested cities / ZIPs / radius | "Widening the area spreads the same budget thinner unless the budget changes too." |
| R6 | **Change the phone number or landing page** | Campaign; new number and/or new URL | "PSG has to re-check call and form tracking before leads count correctly again." Routes to Tracking & Attribution. |
| R7 | **Ask for a performance review** | The question; the period | No change is made. This is a question, not a campaign edit. |
| R8 | **Report a problem** | What's wrong; an example; when it happened | Confirmed within one business day, answered within two (**D5**). |

**Budget request routing (D3, D4).** Every budget request is handled on one of three
paths, and the path is set by the request itself:

| Request | Path |
| --- | --- |
| Increase of **more than 25%** or **more than $500/month** (whichever bar is hit first) | Two named PSG approvers — account manager plus a director. The second approval is **asynchronous**; no meeting is scheduled for it. |
| Any smaller increase | One named PSG approver, with a written record on the request. |
| Any decrease **above zero** | Fast path — one approver, actioned the same business day, no two-person gate regardless of size. |
| A decrease **to zero** | Not a budget change — this is a **stop**. Routes to the account manager as a pause/cancel conversation, because it affects billing and the contract. |

### 3.1 Never customer-self-service

These stay under PSG control with no customer-facing request path at all. If a customer
asks, it becomes an R7 conversation with a PSG specialist:

bidding strategy; match types; negative keyword lists; audience and targeting internals;
conversion action configuration; manager-account linking; Google billing and payment
method; anything that spends money the moment it is saved.

**Removing self-service is not the same as removing the ability to ask (D10).** A new
campaign is not self-service, but the page keeps a visible **"Talk to us about a new
campaign"** button that opens the handoff to the account manager. The same principle
applies to everything in this section: no dead ends, always a way to start the
conversation.

### 3.2 Defects in the current request form

- **Three buttons map to two request types.** "Request a performance check-up" is stored
  as `campaign_adjustment`, identical to "Request an ad change". PSG cannot triage or
  report on these separately. The stored `request_type` enum must cover the request set
  in §3 — at minimum add a non-change `question` type so R7 never enters a change queue.
- **"Budget notes" is unlabelled free text.** A customer typing "$2,000" into it creates
  an implied spending instruction that is unstructured, unvalidated, and not binding on
  anyone. Replace with the structured numeric field in R1, plus explicit
  "this is a request, not an authorization" wording.
- **No before-submit summary** — the Send button submits immediately. See §4.
- **Nothing on the page states that PSG makes the change, not the customer.**

---

## 4. The before-submit summary (mandatory)

No request may be submitted without the customer first seeing a summary and ticking a
confirmation. The summary shows, in this order:

1. **What you're asking for** — the request type in plain words.
2. **Which campaign** — name, or "Not about a specific campaign".
3. **What would change** — `from <current value>` → `to <requested value>`. For requests
   with no numeric change, the description.
4. **What this costs today** — always: *"Nothing changes right now. Your spending is not
   affected by sending this."* For R1 additionally, monthly first per **D6**: *"If PSG
   agrees, your monthly maximum would go from $X to $Y — about $Z more a month (roughly
   $A a day instead of $B)."*
5. **What happens next** — *"PSG reviews this. Nothing in your live Google Ads account
   changes until a PSG specialist makes the change and confirms it back to you."* Followed
   by the published promise from **D5**, verbatim: *"We'll confirm we've got your request
   within one business day, and give you an answer within two."* — with "business days
   only" stated.
6. **Confirmation checkbox** — *"I understand this is a request. PSG will review it
   before anything changes."* Submit stays disabled until ticked.

The summary must be built from the same values the request row will store, so the
customer confirms exactly what gets saved.

---

## 5. States

Nine states. Each needs its own copy; none may show fabricated zeros or an empty chart
that reads as "your ads produced nothing".

| # | State | Trigger | What to show | Requests |
| --- | --- | --- | --- | --- |
| 5.1 | **Never connected** | No `google_ads_accounts` row | "PSG hasn't connected your Google Ads account yet." Who to contact + expected timing. **No metric tiles, no zeros, no charts.** | R7 and R8 only |
| 5.2 | **Connected, no data yet** | Account linked, no snapshots | "Connected on <date>. Your first numbers appear after Google's first full day of reporting." | R7, R8 |
| 5.3 | **Healthy** | Linked + recent snapshots | Full page per §2 | All |
| 5.4 | **Tracking unverified** | `conversion_tracking_verified` false/absent | Spend, clicks, impressions shown. Leads and cost-per-lead show `Unconfirmed` with the reason and "PSG is fixing this." | All, but R1 budget increases carry a warning: "PSG usually wants lead tracking working before spending more." |
| 5.5 | **Disconnected by the customer** | Customer used Disconnect | Historic numbers frozen: "Your numbers stop at <date> because the Google Ads connection was turned off." Reconnect path. | R7, R8 |
| 5.6 | **Access revoked at Google** | `status = revoked` | **This is 2 of the 3 rows in Nick's screenshot.** Never show the word "Revoked" alone. Say: "PSG's access to this Google Ads account was turned off on <date>. We can't update your numbers until it's reconnected." One-click "Ask PSG to reconnect". | R7, R8 + reconnect |
| 5.7 | **Sync error** | `status = error` / failed sync | "We couldn't reach Google Ads on <date>. PSG has been alerted and is looking at it." **Never render `last_error` verbatim.** | All |
| 5.8 | **Partially healthy** | Some accounts linked, some revoked/error | State plainly which numbers are affected: "One of your two ad accounts isn't reporting, so the totals below are incomplete." | All, with the caveat repeated in the summary |
| 5.9 | **Not on the Performance plan** | Tier gate | Current `TierGateCard`. Must not imply anything is broken — it's a plan level, not a fault. | None |

---

## 6. Safety rules

These are the acceptance conditions for PSG-3041 (Tess) and the answer to the question
Nick was asked to approve.

**S1 — No customer action reaches Google.** No route reachable by a shop user may call a
Google Ads mutate endpoint, directly or through the Ads Mutation Studio bridge
(`/api/ads-mutations/dry-run`, `/api/ads-mutations/execute`). Customer submissions write
to `google_ads_customer_requests` and nowhere else.
**S1 is currently violated in production — see §1a.** It is the single hard blocker on
this feature. Nick cannot be told customers cannot change live campaigns until the three
endpoints in §1a are removed or moved behind `requireOpsFn("ads_mutations")`.

**S1a — Routes, not buttons, are the boundary.** A mutation endpoint is considered
customer-reachable if its own authorization allows a shop role, regardless of whether any
UI renders a control for it. Removing a component does not close an endpoint.

**S2 — Every request starts in review.** New requests are created as `submitted`,
displayed as *"Received — waiting for PSG"*. A customer can never set any other status.

**S3 — No automatic execution.** No agent, cron, or automation may action a request. A
named PSG human must be recorded on the record before any live change is made.

**S4 — The only live-change path stays ops-only.** Live campaign changes happen solely
through the Ads Mutation Studio, which keeps its existing controls: dry-run first,
required explicit customer ID, high-risk changes gated on a board-confirmation UUID from
an operator-controlled allowlist, and a full before/after audit log. Nothing in this
customer feature may weaken, bypass, or re-expose that path.

**S5 — Spend changes need a named approver, and big increases need two (D3, D4).** An
increase of **more than 25%** or **more than $500/month** — whichever bar is hit first —
requires a PSG account manager **plus** a director, recorded on the request. Every smaller
increase still requires one named approver and a written record. The second approval is
asynchronous. Decreases above zero take the one-approver fast path (**D4**); a decrease
**to zero** is a stop, not a budget change, and routes to the account manager.

**S6 — "Done" means verified live.** A request is only marked done after the change is
confirmed present in the next Google Ads sync — not when a PSG person says they did it.

**S7 — Withdrawal.** A customer may cancel a request while it is `submitted` or
`needs_more_info`. Once PSG starts work it can only be discussed, not silently edited.

**S8 — Shop isolation.** Every read and write is scoped to the caller's `shop_id`. No
customer sees another shop's account IDs, campaigns, numbers, or requests. §1b is an open
violation and must be closed.

**S9 — No consumer personal information.** Search terms, form contents, and caller
details never appear on this page.

**S10 — Full audit trail.** Who requested, when, who at PSG actioned it, what actually
changed in Google, and when — retained and retrievable.

**S11 — Attribution language.** Never write copy implying the customer changed something.
"PSG raised your daily budget to $25 on Aug 22", not "Your budget is now $25".

---

## 7. Handoff

**All ten product decisions in §8 are settled — design and build against them, not against
the earlier recommendations.** The six that change what appears on screen are **D5, D6,
D7(b), D8, D9, D10**.

**Uma (PSG-3039, design):** design against §2 (field list + meanings), §3 (request types
and inputs), §4 (the summary screen — this is the most important new screen), and §5
(nine states, each needing real copy). The customer-facing page should be about
performance and requests; per **D2** the linked-accounts table with raw customer IDs and
error strings moves to a PSG-only settings surface and does not appear here. Layout
consequences of the decisions: monthly budget is the headline with daily beneath it
(**D6**); the real date range appears in words with the last 3 days marked (**D9**);
campaigns without an approved description still render, with placeholder copy (**D7**);
shops with no lead definition show "not set up yet" where a Leads number would be
(**D8**); the "Talk to us about a new campaign" button stays visible (**D10**); and the
D5 promise is published on the page verbatim.

**Ada (PSG-3040, engineering):** **§1a is the blocker and comes first** — close the three
customer-reachable mutation endpoints before anything else on this feature moves. Then
§1b (cross-shop account row), §1c (viewer role), the `budgetResourceName: null`
divergence, and the corrections in §2.3 (raw status enum, unlabelled campaign metric
window), §2.4 (ranking claim), §3.2 (request-type enum, budget-notes field), §4 (summary +
confirmation) and §5 (states). Note the richer Ads page is not on `main` — decide whether
it merges forward or is rebuilt from this spec before estimating. Data work the §8
decisions create: a per-shop **primary account** designation plus an internal flag when a
non-primary account has spend (**D1**); an approved-description field with a draft/approved
distinction on the campaign record (**D7**); a per-shop lead-definition record that gates
every leads figure and can be genuinely absent (**D8**); and approval metadata on the
request row — approver identity, second approver where **D3** requires one, and the
decrease-to-zero routing from **D4**.

**Tess (PSG-3041, verification):** §6 is the checklist. S1, S1a, S4, and S8 must be proven
by test, not inspection. The specific test that matters: authenticate as a shop `owner`
and call `POST /api/ads/google/campaigns` and `PUT /api/ads/google/campaigns/[id]`
directly, with no UI. Both must be refused.

---

## 8. Decisions — settled

These ten questions are **closed**. Steve ruled on all ten on 2026-08-20 (PSG-3044,
follow-through PSG-3048). They are no longer open options and are not up for
re-litigation in design or build. Where the reasoning is useful to whoever builds it, it
is kept below the decision.

Eight were confirmed as recommended; **D5** (published response time) and **D6** (which
budget number leads) were changed. Seven carry an addition that is part of the decision.

**Decisions that change what appears on screen — read these first if you are designing or
building:** D5, D6, D7(b), D8, D9, D10.

| # | Decision | Settled as |
| --- | --- | --- |
| D1 | Multiple linked accounts | One PSG-designated primary account; others hidden. Hidden spend must raise an internal flag. |
| D2 | Account linking on the customer page | Removed. Moves to Settings, PSG-only. |
| D3 | Two-person approval threshold | Increase >25% **or** >$500/month, whichever triggers first. Every increase needs one named approver. |
| D4 | Decreases move faster | Yes — one approver, same business day. Decrease **to zero** routes to the account manager instead. |
| D5 | Published response time | "Confirm within one business day, answer within two." Business days, stated on the page. |
| D6 | Budget numbers | Show both. **Monthly is the headline**; daily sits beneath as supporting detail. |
| D7 | Campaign description | Account manager writes and approves it. AI draft allowed as a starting point only. Campaigns with no approved description still appear. |
| D8 | "What counts as a lead" | Tracking & Attribution Analyst owns it, shown on the page. **No definition → no Leads number.** |
| D9 | Reporting window | Last 30 days ending today, dates printed in words, last 3 days marked as still filling in. |
| D10 | Request a new campaign | Routes to the account manager — but a visible "Talk to us about a new campaign" button stays. |

---

### D1 — One primary account; hidden accounts may not hide spend

**Decided.** Where a shop has more than one linked Google Ads account, PSG designates one
as primary. The customer page shows the primary account's numbers only. The other linked
accounts are not shown to the customer.

**Part of the decision:** hiding an account must never hide **spend**. If a non-primary
linked account carries real spend, that raises an internal flag to the account manager —
it may not silently vanish from the customer's totals. A page that under-reports a
customer's own spend is worse than a page that shows three confusing account numbers.

*Note for whoever builds it:* at least one of Riverside's three accounts is the
cross-client contamination in §1b. The "three accounts" case there is partly a bug, not a
real product situation — fix §1b before treating Riverside as the reference case.

### D2 — Account linking comes off the customer page

**Decided as recommended, no change.** Linked-account management moves to Settings and is
PSG-only. It does not appear on the customer Ads page in any form.

An owner cannot act on a raw customer ID, and "Disconnect" sitting one click away from a
customer who cannot tell what it does silently stops all of their reporting. That is not
something we ship.

### D3 — Two-person approval on budget increases

**Decided, with the wording tightened for whoever builds it.** "Whichever comes first"
was ambiguous; the rule is:

> Two-person approval is required when a monthly budget increase is **more than 25%** OR
> **more than $500/month** — whichever bar is hit first (the lower of the two).

**Part of the decision:**
- Every increase, **including ones below the threshold**, still requires one named PSG
  approver and a written record on the request.
- The second approver is **asynchronous** — no meeting, no scheduled call. If the
  two-person check ever starts costing us the D5 answer time, the process is wrong, not
  the published promise.

### D4 — Budget decreases move faster

**Decided as recommended.** A decrease needs one approver, is actioned the same business
day, and carries no two-person gate regardless of size. It is the customer's money and we
should never look reluctant about giving it back.

**Carve-out, part of the decision:** a decrease **to zero** is not a budget change, it is
a stop. It routes to the account manager as a pause/cancel conversation, because it
affects billing and the contract. Every other decrease goes on the fast path.

### D5 — Published response time (CHANGED from the recommendation)

**Changed.** We do **not** publish "acknowledge same business day." We cannot hit that for
a request submitted at 6pm on a Friday, and a published promise we miss is worse than a
slower one we always keep.

**Publish this on the page, verbatim:**

> We'll confirm we've got your request within **one business day**, and give you an
> answer within **two**.

The clock counts **business days only**, and the page says so in those words. This is
deliberate under-promising — we will usually beat it, and beating a published promise is
free goodwill.

### D6 — Show the daily budget, but lead with the monthly figure (CHANGED)

**Changed.** Yes, show the daily budget — hiding it costs trust. But the actual decision
is which number is the headline, and it is the **monthly** one: **shop owners think in
months, not days.**

On screen:
- The **monthly** figure is the big number.
- The **daily** figure sits underneath it as supporting detail.
- The plain-English note stays with the daily figure: Google may spend up to about twice
  the daily amount on a busy day and less on a slow one, but will not exceed the monthly
  total.

Leading with a daily number invites "why did you spend $94 yesterday when I said $50?"
every single month.

### D7 — The account manager writes the campaign description

**Decided as recommended.** The PSG account manager writes the one-line plain-English
purpose for each campaign. It is stored on the campaign record. A wrong description is
worse than none.

**Part of the decision, two parts:**

**(a) AI draft as a starting point only.** A draft may be auto-generated, but nothing
publishes until the account manager has edited and approved it. That keeps the accuracy
guarantee while making the work cheap enough that it actually gets done.

**(b) A campaign with no approved description still appears.** It is shown with
**"Description coming — ask your account manager"** in place of the purpose line. We never
hide a campaign the customer is paying for just because we have not written the sentence
yet.

### D8 — Lead definition owned by Tracking; no definition means no number

**Decided as recommended.** The Tracking & Attribution Analyst owns and maintains the
per-shop "what counts as a lead" definition, and it is shown on the page.

**Part of the decision, and this is the one that matters:** if a shop has **no defined
lead definition**, we do **not** show a Leads number for that shop. We show **"not set up
yet."**

Without a definition the count is unauditable, so the conclusion is that we do not print
it. A blank is honest; a number we cannot defend in front of a customer is not. This
applies to the Leads tile, cost-per-lead, and every per-campaign leads figure.

### D9 — Last 30 days ending today, with the real dates printed

**Decided as recommended.** The default reporting window is the last 30 days ending today,
with the settling notice. Simpler to explain than a shifted window.

**Part of the decision:**
- Print the **actual date range in words** on the page — e.g. "Jul 21 – Aug 20".
- **Mark the most recent 3 days as still filling in.**

Nobody should have to work out what "last 30 days" means, or wonder why yesterday looks
weak.

### D10 — New campaigns go through the account manager, but the ask stays visible

**Decided as recommended.** "Request a new campaign" routes to the account manager. A new
campaign usually changes scope and price, so it is a conversation.

**Part of the decision:** it must **not** be a dead end. A visible button — **"Talk to us
about a new campaign"** — stays on the page and opens the handoff to the account manager.
Removing self-service is what we want; removing the customer's ability to ask is not.

---

### Where these decisions land in the rest of this spec

| Decision | Sections it governs |
| --- | --- |
| D1 | §2.1 (page-level), §5.8 (partially healthy) |
| D2 | §2.7, §7 (Uma) — linked-accounts table leaves the customer page |
| D3, D4 | §3 R1, §6 S5 |
| D5 | §2.1 (page-level promise), §4 step 5 |
| D6 | §2.3 (budget rows) |
| D7 | §2.3 ("What it's for") |
| D8 | §2.2 (Leads, cost per lead), §2.3 ("What counts as a lead", "Leads this window"), §5.4 |
| D9 | §2.1 (reporting window, settling notice) |
| D10 | §3 R3, §3.1 |
