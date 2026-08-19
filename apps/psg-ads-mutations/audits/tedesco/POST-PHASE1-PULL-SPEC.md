# Tedesco Auto Body — Post-Phase-1 Google Ads Pull Spec + Confounder Pre-Brief

**Status:** ⛔ DATA PULL BLOCKED on account access (see PSG-1245). Numbers below marked `PENDING PULL` are NOT estimated — do not fill with guesses.
**Owner:** Drew (Paid Media Director) | **For:** Quill (Research, PSG-1245 / PSG-1243) → Lee (public-launch review)
**Purpose:** Turn the Tedesco pilot into a *defensible* public before/after case study for the "New Front Door" campaign. This file locks the matched-window methodology so the pull is apples-to-apples and every confounder is caught before any number ships publicly.

---

## 0. Why this pull is currently blocked (read first)

To pull Tedesco's live Google Ads performance I need **first-party account read access**, and neither channel is available in the current environment:

1. **The `google-ads-mcp` read server is not connected** to this agent session (it's how the May baseline was pulled — see `apps/psg-ads-mutations/CLAUDE.md`: "Reads are handled by the `google-ads-mcp` MCP server").
2. **No `.env` credentials** exist in `apps/psg-ads-mutations/` (only `.env.example` with empty fields). The Google Ads API developer token, OAuth client ID/secret, refresh token, and MCC login-customer-id are all absent.

Per PSG standard: **we never invent ad numbers, and this is for a public claim.** So the pull is blocked until an operator provisions read access (either option unblocks it):
- **Option A (preferred):** connect the `google-ads-mcp` read server to Drew's agent session, OR
- **Option B:** populate `apps/psg-ads-mutations/.env` with the 5 Google Ads API credentials (developer token, client ID, client secret, refresh token, MCC `6935795509`). Do **not** paste secrets into any issue.

Once either lands, this spec is fill-in-the-blanks and the report ships same-day.

---

## 1. Account (same as baseline — DO NOT SWITCH)

- **Customer ID:** `7763526490` (776-352-6490)
- **MCC:** `6935795509` (693-579-5509, PSG)
- **Currency / TZ:** USD / America/Chicago
- **Baseline source of record:** `apps/psg-ads-mutations/audits/tedesco/GOOGLE-ADS-REPORT.md`

## 2. Windows

| Window | Dates | Type | Purpose |
|---|---|---|---|
| **Baseline (before)** | **Apr 18 – May 18, 2026** | LAST_30_DAYS at audit time (2026-05-18) | Locked, do not re-derive |
| **Post-Phase-1 (after)** | **Jun 8 – Jul 8, 2026** | Explicit range (NOT LAST_30_DAYS) | ~3 wks settle after May 2026 fixes |
| **YoY seasonality control** | **Jun 8 – Jul 8, 2025** | Explicit range | Isolate seasonal lift — see §5. Optional if account too new. |

> Use an **explicit start/end range**, not `LAST_30_DAYS`, so the pull is reproducible and traces exactly to the case study.

> ⚠️ **Baseline contamination caveat (important):** The 74 Phase-1 mutations landed **2026-05-12** (`ops/tedesco/HANDOFF.md`), which falls *inside* the Apr 18 – May 18 baseline window — so the baseline's last ~6 days already contain post-fix behavior + peak learning-phase volatility. For the cleanest public "before," prefer a window **fully before May 12** (e.g. **Apr 11 – May 11, 2026**) as the true pre-fix baseline; the locked Apr 18 – May 18 numbers remain the "audit-time" reference but are *not purely pre-fix*. State which baseline the public lift figure uses.

## 3. Top-line metrics to pull (same basis as baseline)

| Metric | Baseline (Apr 18 – May 18) | Post-Phase-1 (Jun 8 – Jul 8) | YoY (Jun 8 – Jul 8, 2025) |
|---|---|---|---|
| Total spend | $3,049.02 | `PENDING PULL` | `PENDING PULL` |
| Clicks | 4,575 | `PENDING PULL` | `PENDING PULL` |
| Impressions | 135,845 | `PENDING PULL` | `PENDING PULL` |
| CTR | 3.37% | `PENDING PULL` | `PENDING PULL` |
| Conversions | 70.50 | `PENDING PULL` | `PENDING PULL` |
| CPA | $43.25 | `PENDING PULL` | `PENDING PULL` |
| **Health score** | **60 / 100 (Grade C)** | `PENDING PULL` (re-run 66-check) | n/a |

## 4. Per-campaign table (same shape as baseline)

Pull `Campaign | Channel | Bid Strategy | Spend | Clicks | Impr | CTR | Conv | CPA` for ENABLED campaigns, and **explicitly diff campaign set vs baseline** (added / paused / restructured). Baseline ENABLED set for reference:

| Campaign ID | Campaign | Channel | Bid Strategy (baseline) |
|---|---|---|---|
| 20834950785 | Auto Body and Collision Repair Tesla Rivian | SMART | TARGET_SPEND |
| 22904042869 | Insurance-Focused Family Commuter | SEARCH | MAX_CONV |
| 22904043352 | Quality-Driven Luxury Owner | SEARCH | MAX_CONV |
| 22904043355 | Budget-Conscious Urban Driver | SEARCH | MAX_CONV |
| (EV Owners) | EV Owners | SEARCH | MAX_CONV |

Baseline daily budgets (from `ops/tedesco/HANDOFF.md`): Smart **$22.10/day**; each Search campaign **$20.00/day** (≈ $82.10/day combined). **Flag any budget change** in the after window — it makes CPA/volume shifts partly mechanical (see §5).

---

## 5. CONFOUNDER PRE-BRIEF — this is what makes or breaks the public claim

Grounded in first-party PSG records (`ops/tedesco/HANDOFF.md`, baseline audit). Quill: resolve each of these with the actual pull before computing any lift figure.

### 5a. Conversion-tracking correction — ⚠️ THE CRITICAL ONE
Phase-1 changed how conversions are tracked. From the handoff:
- **Phase 1.2:** "Start Estimate Request" **no longer back-fills a fake $1,620 value.** (This changes conversion *value*, and possibly value-based bidding, but not necessarily the *count*.)
- **Phase 1.1b:** `DOWNLOAD~APP` conversion goal biddable flipped **false** (Tedesco has no app).
- Baseline (May 18) had **2 advertiser-controlled ENABLED primaries** ("Start Estimate Request" BOOK_APPOINTMENT + "Contact Us" CONTACT/GA4) plus 4 Smart-Campaign system actions.

**Action on pull:** confirm the **exact same conversion actions are ENABLED and counted** in the after window. If the counted set changed, **raw conv / CPA are NOT directly comparable** — say so explicitly and, if possible, recompute a **like-for-like** figure restricted to the conversion actions present in *both* windows. Do not headline a conversion or CPA delta until this is settled.

### 5b. Budget / daily spend
Baseline active spend ≈ $3,049 / 30d. If daily budgets or total spend materially changed between windows, CPA and volume shifts are **partly mechanical, not quality-driven.** Report spend side-by-side; if spend moved >±15%, caveat the CPA delta.

### 5c. Campaigns added / paused / restructured
Phase-1 itself was configuration (geo PRESENCE_OR_INTEREST→PRESENCE, shared negative lists, sitelinks, conversion fix, wasted-spend cuts) — **not** add/pause of campaigns. BUT the baseline audit's action plan *recommended* further structural moves (portfolio bidding, PMax re-enable, brand-campaign split, RSA rebuilds). If any were executed May→Jul, they confound a "Phase-1 only" attribution. The per-campaign diff (§4) surfaces this.

### 5d. Seasonality — ⚠️ inflates the "after" side
Collision-repair demand is **seasonally higher in summer (Jun–Jul) than spring (Apr–May)**: summer is the industry's peak driving/repair season (more miles driven → more accidents); spring is not a demand peak. So a naive Jun–Jul-vs-Apr–May comparison would **credit Phase-1 for lift that is partly seasonal.** This is why the **YoY Jun–Jul 2025 control (§2) matters** — it isolates the seasonal component. If YoY is unavailable (account too new), the public claim must be caveated as "not seasonally adjusted" and lean on **account-quality (health score) and efficiency (CTR/CPA) deltas** rather than raw volume. Sources: CCC Crash Course; industry seasonality reporting (summer = peak collision-repair season).

---

### 5e. Clicks/CPC will look WORSE by design — don't let the story lead with clicks
Phase-1 deliberately removed junk traffic: 506 negatives/campaign, tighter PRESENCE geo, Search Partners off. Expect **fewer clicks and higher CPC** in the after window — that's the fix working, not a regression (junk partner/out-of-market clicks were cut). The honest success metric for a public claim is **conversions + CPA (lead quality)**, NOT click volume or CPC. Frame the narrative around lead efficiency/quality and account-health-score improvement.

## 6. Data provenance (record on every pull)

- Customer ID `7763526490`, MCC `6935795509`
- Exact date range used (explicit range, not LAST_30_DAYS)
- Pull timestamp (UTC) + who/what ran it
- Resource list pulled (customer, campaign, campaign_budget, conversion_action, metrics via GAQL)

## 7. Format of the deliverable

Short markdown report (like the May audit) at `apps/psg-ads-mutations/audits/tedesco/GOOGLE-ADS-REPORT-POST-PHASE1.md`, attached to PSG-1245. Numbers + confounder resolutions are what matter; full 66-check re-audit only needed for the health-score delta (§3).

## 8. What happens next (per PSG-1245)

On completion this auto-wakes Quill → single verified lift figure + before/after narrative → Adversarial-Verification + Evidence/Statistical-Rigor lenses → campaign companion doc update → Lee for public-launch review. **If a confounder makes a clean lift impossible, we report that honestly rather than force a number.**
