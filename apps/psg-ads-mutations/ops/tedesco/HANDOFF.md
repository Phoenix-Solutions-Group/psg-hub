# Tedesco Auto Body — Google Ads Handoff
**Account:** 776-352-6490 (customer_id: `7763526490`)
**MCC:** 693-579-5509 (`6935795509`)
**Agency:** Phoenix Solutions Group
**Date:** 2026-05-12
**Status:** Phases 1–3 + 5.1 deployed. Account live, search campaigns in fresh Smart Bidding learning phase. Awaiting Day 14 metrics gate (2026-05-26).

---

## What Was Changed

Unlike a greenfield build, Tedesco was an existing account with structural and tactical misconfiguration across every surface. 74 verified mutations applied to live account. Every mutation is reversible and has a JSON audit log in `apps/ads/logs/`.

**Baseline Ads Health Score: 34 / F. Expected post-cleanup score: 65+ within 30 days.**

| Phase | Surface | Outcome |
|-------|---------|---------|
| 1.1b | Conversion goals | `DOWNLOAD~APP` biddable flipped to false (Tedesco has no app) |
| 1.2 | Conv tracking | `Start Estimate Request` no longer back-fills $1,620 fake value |
| 1.3 | Networks | Search Partners disabled on 4 search campaigns |
| 2.1 | Bidding | 4 search campaigns: `TARGET_SPEND` → `MAXIMIZE_CONVERSIONS` (no tCPA, learning phase) |
| 2.2 | Negatives | 506 negatives per campaign (2,024 mutations) — incl. cross-cannibalization exact negatives |
| 2.3 | Geo | 13 NYC-metro geos cloned to each of 4 search campaigns (52 mutations) |
| 3a | Assets | CALL `(914) 636-3000` promoted to customer level |
| 3b | Assets | 5 cert callouts: Tesla / Porsche / Rivian Certified, OEM Parts Only, Lifetime Warranty |
| 3c | Assets | 3 cert sitelinks with descriptions |
| 3d | Assets | Square business logo uploaded (2918×2918 PNG) |
| 3e | Assets | 6 sitelinks rebuilt with desc1+desc2; Schedule Estimate re-pointed to `/start-estimate/` |
| 5.1 | Modifiers | DESKTOP `bid_modifier` → 0.75 on 4 search campaigns (dormant under MAX_CONV; activates at Day 14 tCPA) |

---

## Active Campaign State

| Campaign ID | Name | Channel | Bid Strategy | Daily Budget |
|---|---|---|---|---|
| `20834950785` | Auto Body and Collision Repair Tesla Rivian | SMART | TARGET_SPEND | $22.10 |
| `22904042869` | Insurance-Focused Family Commuter | SEARCH | MAXIMIZE_CONVERSIONS | $20.00 |
| `22904043352` | Quality-Driven Luxury Owner | SEARCH | MAXIMIZE_CONVERSIONS | $20.00 |
| `22904043355` | Budget-Conscious Urban Driver | SEARCH | MAXIMIZE_CONVERSIONS | $20.00 |
| `22904043358` | EV Owners | SEARCH | MAXIMIZE_CONVERSIONS | $20.00 |

**Total active daily budget:** $102.10 (~$3,063/month).

**Geo (all 4 search campaigns):** Westchester County, Bronx County, Manhattan, plus cities Greenwich CT, Stamford CT, Armonk, Larchmont, Mamaroneck, Pleasantville, Rye, Scarsdale, Thornwood, White Plains.

**Account-level assets** (inherit to all 5 campaigns):
- 8 SITELINKs (all with desc1+desc2 after Phase 3e)
- 10 CALLOUTs (5 generic + 5 cert-specific)
- 1 CALL — (914) 636-3000
- 1 STRUCTURED_SNIPPET (Service catalog)
- 1 BUSINESS_LOGO — 2918×2918 PNG

**Conversion goals biddable:**

| category~origin | biddable | Source |
|---|---|---|
| BOOK_APPOINTMENT~WEBSITE | true | Start Estimate Request |
| CONTACT~WEBSITE | true | Contact Us (GA4) |
| CONTACT~CALL_FROM_ADS | true | Smart Campaign ad clicks to call |
| PHONE_CALL_LEAD~CALL_FROM_ADS | true | Calls from Smart Campaign Ads |
| DOWNLOAD~APP | **false** | (no app; demoted) |
| GET_DIRECTIONS, STORE_VISIT, CONTACT~GOOGLE_HOSTED | false | (correctly off) |

---

## Day 14 Gate — 2026-05-26

Pull last-14-day metrics. Decide whether to layer tCPA.

### Decision criteria

| Signal | Trigger | Action |
|---|---|---|
| Each campaign ≥15 conv in trailing 14d | Met | Layer `target_cpa_micros=50_000_000` ($50 tCPA) per campaign. Activates Phase 5.1 desktop bid mod. Begin +20% budget cycle. |
| 8–14 conv per campaign | Mid-range | Extend learning 7 more days. Re-pull 2026-06-02. |
| <8 conv per campaign | Under-target | Investigate. Likely path: consolidate 4 persona campaigns into 1 with ad-group segmentation (Path A from original plan). |
| CPC averaging <$1.50 | Anomaly | Verify Search Partners didn't re-enable; verify geo locks held. |
| Invalid clicks still >10% | Bad | Open ticket with Google. |

### How to layer tCPA

```bash
cd /Users/schoolcraft_mbpro/apps/ads
source .venv/bin/activate

# Reuse existing campaign_bidding lib. Either edit switch_bidding_max_conv.py
# to set target_cpa_micros=50_000_000 and re-execute, or use a Python REPL:
python -c "
from googleads_psg.client import load_client
from googleads_psg.mutations.campaign_bidding import CampaignBiddingChange, apply_changes
client = load_client()
changes = [CampaignBiddingChange(campaign_id=cid, strategy='MAXIMIZE_CONVERSIONS', target_cpa_micros=50_000_000)
           for cid in [22904042869, 22904043352, 22904043355, 22904043358]]
for r in apply_changes(client, '7763526490', changes):
    print(r)
"
```

---

## Phase 6 — Scale (post Day 14, gated on metrics)

Only run after Score >65 / CPA stable.

Paused campaigns ready for relaunch:

| Campaign ID | Name | Configured tCPA |
|---|---|---|
| `20841656577` | CPC - Tesla Repair - Local +20mi | $16.64 |
| `20847935903` | CPC - Rivian Repair - Local +20mi | $13.31 |

**Whitespace confirmed via SEMrush:** Caliber Collision dominates generic terms (#1 paid on "auto body shop near me," "collision repair near me," etc.) but doesn't bid on Tesla/Porsche/Rivian-specific terms. Tedesco's certifications give it real auction edge.

To enable: Google Ads UI → Campaigns → filter "Paused" → toggle to Enabled. Or via API:

```python
# Use campaign_bidding lib with a status mutation (not yet built — add as needed)
# Or simpler: enable via UI given paused campaigns already have correct bidding configured
```

---

## Open Client Decisions

| # | Decision | Blocks |
|---|---|---|
| 1 | Dedicated `/tesla-repair/`, `/porsche-repair/`, `/rivian-repair/` LPs on tedescoautobody.com — web team | Quality Score lift on cert keywords; Phase 6 relaunch quality |
| 2 | Offline conversion import for true revenue (CRM / Body Shop Booster integration) | Real ROAS reporting; advanced bid strategies |
| 3 | Google Business Profile location asset linkage | Local-pack visibility |
| 4 | Landscape logo (4:1 ratio) — current closest is 2.84:1, Google would reject | LANDSCAPE_LOGO asset |
| 5 | Mobile speed audit of `/start-estimate/` page | Post-click conversion lift |
| 6 | Budget approval for +20% scale after Day 14 (current $80.67/day search → $96.80/day) | Phase 6 scale execution |

---

## Risks + Caveats

1. **Learning phase volatility.** Days 1–14 will show daily swings in clicks, CPC, conv. Normal. Do not adjust budgets or bidding during this window.
2. **Click volume will drop.** 506 negatives + geo lock + Search Partners off compresses click count meaningfully. Prior volume was junk; the drop is intended.
3. **Reported CPC will rise.** Tedesco's $0.70 CPC was artificially low (partner-polluted). Expect $2.50–$3.50 settled. SEMrush market median is $2.88–$3.32 for generic, $4.28–$5.36 for brand cert.
4. **Smart Campaign engagement counting.** Smart Campaign's reported conv volume is inflated by map-clicks-to-call and directions actions. Day 14 metrics review should use SEARCH-only campaign data, not blended.
5. **Phase 1.1 was redirected.** Original goal "demote stale REMOVED conversion actions" hit Google's immutability on REMOVED/UA-Goal/system-managed records. Closed via Phase 1.1b at the customer_conversion_goal layer — correct API surface. Stale ConversionAction records remain visible in UI but are inert for live bidding (they cannot fire new events).

---

## Library-Level Discoveries

These apply to all future PSG client work — file under engineering knowledge.

1. **`protobuf_helpers.field_mask(None, msg._pb)` silently drops bool=False / int=0 fields** from the inferred mask. Google API accepts but no-ops. Pattern: explicit `op.update_mask.paths.extend(updated_fields)`.
2. **Bidding-strategy messages with subfields require subfield mask paths** (`maximize_conversions.target_cpa_micros`), not the parent oneof name.
3. **REMOVED conversion actions are immutable.** Use `CustomerConversionGoal` API instead.
4. **System-managed conversion action types** (ANDROID_INSTALLS_ALL_OTHER_APPS, UNIVERSAL_ANALYTICS_GOAL) reject all mutates.
5. **Smart Bidding ignores standard device bid modifiers** under MAXIMIZE_CONVERSIONS (no tCPA). Only -100% exclusion or activation under tCPA/tROAS.
6. **Customer-level assets cascade automatically to campaigns** — `campaign_asset` query alone misses account-wide coverage. Use `customer_asset` query for full picture.

---

## Files in This Directory

| File | Purpose |
|------|---------|
| `HANDOFF.md` | This document |

(Tedesco scripts live in `apps/ads/ops/tedesco/`. See "Where the Scripts Live" below.)

---

## Where the Scripts Live

**Mutation libraries (shared, reusable across clients):** `apps/ads/googleads_psg/mutations/`

| File | Surface |
|---|---|
| `conversion_actions.py` | Phase 1 — `include_in_conversions_metric`, `value_settings` |
| `customer_conversion_goals.py` | Phase 1.1b — biddable flag |
| `campaign_network.py` | Phase 1.3 — partner / display network |
| `campaign_bidding.py` | Phase 2.1 — 6 bid strategies w/ subfield mask handling |
| `negative_keywords.py` | Phase 2.2 — campaign-level negatives |
| `geo_targets.py` | Phase 2.3 — LOCATION + geo name resolution |
| `assets.py` | Phase 3 — sitelink / callout / snippet / call / image (+ customer/campaign link + remove) |
| `campaign_device_bids.py` | Phase 5.1 — DEVICE criterion bid_modifier |

**Tedesco scripts:** `apps/ads/ops/tedesco/`

| Script | Phase | Status |
|---|---|---|
| `cleanup_conversion_actions.py` | 1.1 | Documents immutability — no real mutations succeed |
| `demote_unused_goals.py` | 1.1b | ✅ Executed |
| `fix_default_value.py` | 1.2 | ✅ Executed |
| `disable_partner_networks.py` | 1.3 | ✅ Executed |
| `switch_bidding_max_conv.py` | 2.1 | ✅ Executed |
| `apply_negative_list.py` | 2.2 | ✅ Executed |
| `clone_geo_targets.py` | 2.3 | ✅ Executed |
| `promote_call_to_account.py` | 3a | ✅ Executed |
| `add_certification_callouts.py` | 3b | ✅ Executed |
| `add_certification_sitelinks.py` | 3c | ✅ Executed |
| `add_business_logo.py` | 3d | ✅ Executed |
| `upgrade_sitelinks.py` | 3e | ✅ Executed |
| `set_device_bid_modifiers.py` | 5.1 | ✅ Executed |

**Audit logs:** `apps/ads/logs/tedesco-*-execute-20260512T*.json` (13 files)

**Client-facing recap PDF:** `apps/ads/reports/tedesco/recap.pdf`

---

## How to Run a Script (or Re-Run)

All scripts follow the same pattern:

```bash
cd /Users/schoolcraft_mbpro/apps/ads
source .venv/bin/activate

# Always dry-run first
python -m ops.tedesco.<script_name> --customer-id 7763526490

# Then execute
python -m ops.tedesco.<script_name> --customer-id 7763526490 --execute
```

Every `--execute` writes a JSON audit log to `apps/ads/logs/` with before/after state. To reverse a mutation, invert the spec in the script and re-execute.

---

## Quick Links

- **Google Ads account:** https://ads.google.com/aw/campaigns?__e=7763526490
- **Recap PDF (client-facing):** `apps/ads/reports/tedesco/recap.pdf`
- **Audit log directory:** `apps/ads/logs/` (filter for `tedesco-*`)
- **PSG Design System (recap source):** Shared drive · 02. Marketing · Brand Assets · Phoenix Solutions Group Design System
- **Tedesco logo source:** Shared drive · PSG Team Drive · Clients Q–T · Tedesco Auto Body · Logo

---

*PSG · Tedesco Auto Body · 2026-05-12*
