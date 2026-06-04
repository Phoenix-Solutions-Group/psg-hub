# Tedesco Auto Body — Remediation Scripts

Customer ID: `7763526490` (776-352-6490)

Baseline audit (last 30d): Score 34/F, search-only true CPA ~$134, rank-lost IS 83-89%, 26.7% invalid clicks, all 32 RSAs POOR, 100% broad-match KWs, cross-campaign cannibalization across 4 persona campaigns.

## Run order

Every script defaults to `--dry-run`. Pass `--execute` to mutate. Each execute writes JSON audit log to `apps/ads/logs/`.

### Phase 1 — Stop the bleed

```bash
# 1.2 Stop inflating reported conv value with $1,620 default — VERIFIED 2026-05-12
python -m ops.tedesco.fix_default_value --customer-id 7763526490 --execute

# 1.3 Turn off search partners on 4 active search campaigns — VERIFIED 2026-05-12
python -m ops.tedesco.disable_partner_networks --customer-id 7763526490 --execute

# 1.1 Cleanup conversion actions — BLOCKED at ConversionAction API level
#   Google rejects mutates on:
#     - REMOVED actions   ("field is immutable")
#     - UA Goals          (MUTATE_NOT_ALLOWED — UA sunset)
#     - System-managed    (ANDROID_INSTALLS_ALL_OTHER_APPS)
#   All flagged actions are inert for live bidding (cannot fire new events).
#   Real fix path = CustomerConversionGoal API at customer level. TBD: 1.1b script.
python -m ops.tedesco.cleanup_conversion_actions --customer-id 7763526490  # dry-run only useful
```

### Phase 1.1b — Customer conversion goal cleanup

```bash
# Demote DOWNLOAD~APP (Android installs) from biddable=true to false — VERIFIED 2026-05-12
python -m ops.tedesco.demote_unused_goals --customer-id 7763526490 --execute
```

Closes the Phase 1.1 gap. The stale `Android installs (all other apps)` conversion action
couldn't be mutated at the ConversionAction surface (Google rejects mutates on system-managed
ANDROID_INSTALLS_ALL_OTHER_APPS type), but the customer-level goal that promotes it to
"primary" IS mutable. Setting `customer_conversion_goal.biddable=false` on DOWNLOAD~APP
stops Smart Bidding from optimizing toward app installs that don't exist (Tedesco has no app).

Final customer_conversion_goal state:

| category~origin | biddable | Backed by ENABLED action |
|---|---|---|
| BOOK_APPOINTMENT~WEBSITE | true | Start Estimate Request |
| CONTACT~WEBSITE | true | Contact Us (GA4) |
| CONTACT~CALL_FROM_ADS | true | Smart campaign ad clicks to call |
| PHONE_CALL_LEAD~CALL_FROM_ADS | true | Calls from Smart Campaign Ads |
| DOWNLOAD~APP | **false** ← demoted | (no real action) |
| CONTACT~GOOGLE_HOSTED | false | (correctly off) |
| GET_DIRECTIONS~GOOGLE_HOSTED | false | (correctly off) |
| STORE_VISIT~STORE | false | (correctly off) |

#### Field-mask gotcha (recorded for future scripts)

When mutating a Google Ads resource, build `update_mask.paths` **explicitly** from the fields you set:

```python
op.update_mask.paths.extend(updated_fields)
```

Do NOT use `protobuf_helpers.field_mask(None, ca._pb)`. It infers the mask from non-default proto values, so setting `bool=False` (proto default) gets silently dropped from the mask. The API then returns 200 OK with a field mask in the response but the value is unchanged. Lost an hour debugging this on Phase 1.2/1.3.

### Phase 1.4 — Orphan budgets (manual)

Google Ads `CampaignBudget` has no `PAUSED` state — only `REMOVED`. REMOVE is destructive and only works when no campaigns are attached. Do this in the UI:

| Budget ID | Name | Action |
|---|---|---|
| 7488246904 | Covid 19 | Remove |
| 1764363029 | Tesla Approved Body Shop | Keep — Phase 6 relaunch candidate |
| 13209032306 | CPC - Tesla Repair - Local +20mi | Keep — Phase 6 relaunch candidate |
| 13214407602 | CPC - Rivian Repair - Local +20mi | Keep — Phase 6 relaunch candidate |
| 11470595648 | Performance Max Test ($50/day) | Remove (high blast-radius if accidentally enabled) |
| 10720616574 / 10723587304 | Local PMax | Remove |
| 7488067151 | All Makes and Models | Remove |
| 1907371402 | SEARCH LEADS SERVICE 20 MILES CPC | Remove |
| 7488066443 | Certifications | Remove |
| 11476333866 | Performance Max Test | Remove |

### Phase 2 — Bidding + negatives

```bash
# 2.1 Flip 4 search campaigns to Maximize Conversions — VERIFIED 2026-05-12
python -m ops.tedesco.switch_bidding_max_conv --customer-id 7763526490 --execute

# 2.2 Copy Smart Campaign 502 negatives + 4 cross-cannib exacts — VERIFIED 2026-05-12
#     (2024 ops succeeded. 506 total negatives per target campaign.)
python -m ops.tedesco.apply_negative_list --customer-id 7763526490 --execute
```

#### Field-mask gotcha #2: subfields

Bidding-strategy messages have subfields (e.g., `maximize_conversions.target_cpa_micros`).
Update mask must reference the **subfield path**, not the parent oneof name.
Error if you mask the parent: `"The field mask updated a field with subfields: 'maximize_conversions'."`
For empty-message strategies (`target_spend`, `manual_cpc`), mask the parent.

### Phase 2.3 — Geo targeting

```bash
# Clone Smart Campaign 13 geo targets to 4 search campaigns — VERIFIED 2026-05-12
python -m ops.tedesco.clone_geo_targets --customer-id 7763526490 --execute
```

Discovered during execute: 4 search campaigns had **zero** LOCATION criteria.
Were serving on account-level default (likely USA-wide). Now constrained to:
Greenwich CT, Stamford CT, Armonk NY, Larchmont NY, Mamaroneck NY,
Pleasantville NY, Rye NY, Scarsdale NY, Thornwood NY, White Plains NY,
Bronx County, Westchester County, Manhattan.

### Phase 2 — Decision gate (Day 14)

Re-pull campaign metrics. If 15+ conversions per campaign trailing 14d:
- Layer tCPA via separate script: `set_tcpa.py --campaign-id <id> --target-cpa-micros 50000000` ($50 tCPA)

Until then: no tCPA, no campaign edits during learning phase.

### Phase 3 — Assets

Phase 3 reconnaissance discovered the account already has decent customer_asset
(account-level) coverage that auto-inherits to all 5 campaigns:
- 5 SITELINK (Contact Us, Electric Vehicle Service, Customer Testimonials, Certifications, About Us — all without descriptions)
- 5 CALLOUT (Free Mobile Estimates, Factory Trained Techs, High Standard Of Repairs, Open Mon-Sat, 100% Satisfaction)
- 1 STRUCTURED_SNIPPET (Service catalog: Certified Repairs, Aluminum Repairs, Insurance Approved, Industry Certified Techs)

Missing at account level: CALL asset (phone only on Smart Campaign), cert-specific callouts/sitelinks.

```bash
# 3a Promote phone (914) 636-3000 to account level — VERIFIED 2026-05-12
python -m ops.tedesco.promote_call_to_account --customer-id 7763526490 --execute

# 3b Add 5 cert callouts (Tesla/Porsche/Rivian Certified, OEM Parts, Lifetime Warranty) — VERIFIED 2026-05-12
python -m ops.tedesco.add_certification_callouts --customer-id 7763526490 --execute

# 3c Add 3 cert sitelinks with descriptions (Schedule Estimate, Tesla Approved, Porsche Cert) — VERIFIED 2026-05-12
python -m ops.tedesco.add_certification_sitelinks --customer-id 7763526490 --execute
```

Account-level asset inventory after Phase 3a-c:
- **SITELINK**: 5 existing (no desc) + 3 new (with desc) = **8 total**
- **CALLOUT**: 5 generic + 5 cert = **10 total**
- **CALL**: **1** (914) 636-3000 — newly account-wide
- **STRUCTURED_SNIPPET**: 1 (Service catalog) — unchanged

### Phase 3e — Upgrade sitelinks

```bash
# Replace 5 description-less sitelinks + fix Schedule Estimate URL — VERIFIED 2026-05-12
python -m ops.tedesco.upgrade_sitelinks --customer-id 7763526490 --execute
```

Pattern: sitelinks are immutable on link_text/url/descriptions. Script creates 6 new, links them, then removes 6 old customer_asset links. Underlying old Assets stay in the account (history) but no longer surface.

Schedule Estimate now points to `/start-estimate/` (matches all 62 RSAs).

Final account-level SITELINK inventory (8, all with descriptions):
| Link Text | URL | desc1 | desc2 |
|---|---|---|---|
| About Us | `/about-us/` | Trusted Westchester Body Shop | OEM Certified Repairs |
| Certifications | `/certifications/` | Tesla, Porsche, Rivian Certified | OEM Parts. Lifetime Warranty. |
| Contact Us | `/contact/` | Call (914) 636-3000 | Open Mon-Sat for Estimates |
| Customer Testimonials | `/customer-reviews/` | 5-Star Westchester Reviews | Real Customer Stories |
| Electric Vehicle Service | `/electric-vehicle-service/` | Tesla, Rivian, Porsche Certified | OEM Parts. Battery Aware. |
| Porsche Certified | `/certifications/` | Porsche Approved Repair | OEM Parts Factory Standards |
| Schedule Estimate | `/start-estimate/` | Free Estimate, Mobile Avail | OEM Parts. Lifetime Warranty. |
| Tesla Approved Repair | `/certifications/` | Certified Tesla Body Shop | EV Battery Aware Aluminum |

### Phase 3d — Business logo

```bash
# Upload 2918x2918 square logo, link as BUSINESS_LOGO at account level — VERIFIED 2026-05-12
python -m ops.tedesco.add_business_logo --customer-id 7763526490 --execute
```

Source: `Vector Logo_Tedesco 002B-01.png` from `~/Library/CloudStorage/.../Tedesco Auto Body/Logo/`.
Asset 360246115479 ENABLED, inherits to all 5 campaigns.

### Phase 3 — Deferred

- LANDSCAPE_LOGO: needs 4:1 ratio. Closest available logo is 2.84:1 — would be rejected. Need designer to produce a true 4:1 crop.
- LOCATION (Google Business Profile linking): account-wide via UI, not a CampaignAsset.

### Phase 4 — Structure decision (manual, Day 14)

Path A (consolidate) vs Path B (differentiate) based on cross-campaign duplicate search term spend.

### Phase 5.1 — Device bid modifier

```bash
# DESKTOP bid_modifier 0 -> 0.75 (-25%) on 4 search campaigns — VERIFIED 2026-05-12
python -m ops.tedesco.set_device_bid_modifiers --customer-id 7763526490 --execute
```

Audit data: Mobile $29 CPA, Desktop $71 CPA (2.5x mobile). Setting -25% dampens desktop spend share once active.

**Important caveat**: Google ignores standard device bid modifiers under MAXIMIZE_CONVERSIONS (no tCPA). The 4 search campaigns currently run MAX_CONV (post-Phase 2.1). The -25% modifier is documented intent — becomes active when tCPA layers at Day 14 gate.

If aggressive exclusion preferred over wait-for-tCPA: re-run with `bid_modifier=0.1` (close to -100% floor; full -100% requires criterion negative flag, different surface).

### Phase 5 — Deferred

- Audit estimate LP mobile speed + sticky call CTA — Tedesco web team task
- Offline conv import for real value — requires CRM/Body Shop Booster integration

### Phase 6 — Scale (Day 22+, only after Score >65)

- Relaunch paused Tesla/Rivian search campaigns
- Test PMax with cert asset groups

## Active conversion action map

After Phase 1.1, only these should remain `include_in_conversions_metric=true`:

| ID | Name | Status | Role |
|---|---|---|---|
| 495622033 | Start Estimate Request | ENABLED | Primary form |
| 6705005193 | Contact Us | ENABLED | Primary contact |
| 6830494456 | Calls from Smart Campaign Ads | ENABLED | Primary call (Smart) |
| 6830544411 | Smart campaign ad clicks to call | ENABLED | Primary call (Smart) |

Demoted (`include_in_conversions_metric=false`):

| ID | Name | Status | Why demoted |
|---|---|---|---|
| 313909870 | Tesla Body Repair Ads | REMOVED | Action removed but still counting |
| 425342847 | Calls from ads | REMOVED | Action removed but still counting |
| 495907578 | Get Estimate - Body Shop Booster (RAW) | HIDDEN | Stale UA goal |
| 495907581 | Get Estimate - Body Shop Booster (Test) | HIDDEN | Test action |
| 495907584 | Start Estimate (MASTER) | REMOVED | Stale UA goal |
| 495907587 | Porsche Form Submit (MASTER) | HIDDEN | Stale UA goal |
| 495907590 | Tesla Form Submit (MASTER) | HIDDEN | Stale UA goal |
| 536506466 | Smart Goal (MASTER) | HIDDEN | Engagement, not real conv |
| 616239798 | CROToolkitLandingPage | REMOVED | Action removed but still counting |
| 616269799 | CROToolkitPopup | REMOVED | Action removed but still counting |

`primary_for_goal` requires `CustomerConversionGoal` mutations (separate flow, not handled in Phase 1).

## Active campaigns (after Phase 1)

| Campaign ID | Name | Channel | Current bid | Target after Phase 2 |
|---|---|---|---|---|
| 20834950785 | Auto Body and Collision Repair Tesla Rivian | SMART | TARGET_SPEND | Keep — Smart Campaign |
| 22904042869 | Insurance-Focused Family Commuter | SEARCH | TARGET_SPEND | MAXIMIZE_CONVERSIONS |
| 22904043352 | Quality-Driven Luxury Owner | SEARCH | TARGET_SPEND | MAXIMIZE_CONVERSIONS |
| 22904043355 | Budget-Conscious Urban Driver | SEARCH | TARGET_SPEND | MAXIMIZE_CONVERSIONS |
| 22904043358 | EV Owners | SEARCH | TARGET_SPEND | MAXIMIZE_CONVERSIONS |
