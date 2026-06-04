# Wallace Collision — Action Plan

CID `6048611995`. Sorted by priority. Each item references an audit finding ID and (where possible) a script in `ops/wallace/`.

---

## Critical (fix immediately — revenue/data-loss risk)

### C1 — Clean primary_for_goal on engagement actions [G01, G02]
**Why:** Smart Bidding currently optimizes on Smart-campaign call-clicks and `GA4 qualify_lead` (MANY_PER_CLICK). Real form CPA hidden behind ~10× inflation.

**Actions:**
- Set `primary_for_goal=false` on:
  - `Local actions - Directions` (563131646)
  - `Local actions - Website visits` (564340687)
  - `Local actions - Other engagements` (564345007)
  - `Local actions - Menu views` (7110757091)
  - `Smart campaign map clicks to call` (7258467793)
  - `Smart campaign map directions` (7258748397)
  - `Smart campaign ad clicks to call` (7258748379)
- Set `include_in_conversions_metric=false` on:
  - `Smart campaign ad clicks to call` (7258748379)
- Change `counting_type=ONE_PER_CLICK` on:
  - `GA4 qualify_lead` (7194760257)

**Script:** extend `ops/wallace/fix_conversion_actions.py` pattern.

**Verify:** rerun `mcp__google-ads-mcp__search` on `conversion_action` and check `CustomerConversionGoal` settings.

---

### C2 — Block OEM-generic search terms [G11, G12]
**Why:** ~$540 / 30d wasted on Tesla / JLR dealership, parts, service, warranty terms.

**Actions:** Add to negative-keyword shared list (create if not present):
```
dealership, dealer, for sale, lease, lease deals, buy, buying, purchase, used,
parts, accessories, tires, wheels, rims, battery, batteries, ceramic coating,
windshield, glass, paint kit, paint repair kit, alignment, extended warranty,
service appointment, service near me, maintenance, maintenance cost, coupons,
recall, model 3, model y, model s, model x, cybertruck, f pace, vanden plas,
2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026
```

Apply shared list to Tesla Approved, JLR Certified Collision Repairs, BMW Certified, Rivian Approved, GOOG_WAL_SRCH_TeslaApproved_2026Q2, GOOG_WAL_SRCH_JLRCertified_2026Q2.

**Script:** new `ops/wallace/apply_negative_kw_list.py`.

---

### C3 — Verify Wallace Ford of Kingsport Brand scope [G24, G03]
**Why:** Smart campaign for a Ford *dealer* runs in a *collision center* account; spends $264/mo + HIDDEN GA4 events tied to Ford property. Either wrong account or wrong purpose.

**Action:** confirm with client; pause if mis-scoped. If valid, migrate Ford GA4 events out of this CID.

---

## High (fix within 7 days)

### H1 — Enable brand campaign [G20]
**Why:** Cheapest CPA. Currently paused (`GOOG_WAL_SRCH_Brand_2026Q2`, cid 23825006324).

**Actions:**
- Switch bidding from `TARGET_IMPRESSION_SHARE` → `MAXIMIZE_CLICKS` with $1.50 max CPC.
- Raise budget from $7/d → $15/d.
- Add brand keywords (EXACT + PHRASE): `wallace collision`, `wallace collision center`, `wallace collision center bristol`.
- Enable.

---

### H2 — Landing page experience fix [G30]
**Why:** BELOW_AVERAGE on 95+ keywords → 30–60% CPC penalty.

**Actions:**
- Audit each ad-group landing page for: keyword in H1, phone number above-the-fold, mobile load time <2.5s, schema markup (LocalBusiness + AutoBodyShop), explicit estimate CTA.
- Use `ops/wallace/fix_landing_page.py` to update final_url across ad groups.

---

### H3 — Consolidate to one campaign tree [G20]
**Why:** Legacy (PPC_Wallace_40Miles, Tesla Approved, JLR, BMW, Rivian) + new 2026Q2 = parallel structure. Smart Bidding fragmented.

**Decision required:** finish migration or revert. Recommend **finish migration**:
- Enable: GOOG_WAL_SRCH_LocalCollision_2026Q2, GOOG_WAL_SRCH_TeslaApproved_2026Q2, GOOG_WAL_SRCH_JLRCertified_2026Q2, GOOG_WAL_SRCH_ToyotaCertified_2026Q2, GOOG_WAL_SRCH_Brand_2026Q2.
- After 14-day learning, pause legacy.

**Script:** `ops/wallace/launch_2026q2_swap.py` already in repo (untracked); review and run.

---

### H4 — Standardize bidding strategies [G21]
**Why:** Five bidding strategies across five new campaigns is incoherent.

**Recommendation:**
- LocalCollision (high volume): MAX_CONV with tCPA $35
- Tesla Approved Q2 (low volume, high value): MAX_CONV with tCPA $65
- JLR Certified Q2: MAX_CONV with tCPA $60
- Toyota Certified Q2: MAX_CONV with tCPA $40
- Brand Q2: MAX_CLICKS, $1.50 ceiling

---

### H5 — Tighten geo targeting [G50]
**Why:** Legacy campaigns target full TN+VA+KY. Wallace is in Bristol/Kingsport. Far metros (Nashville, Memphis, Norfolk, Louisville) waste spend.

**Action:** Replace state targeting with 40-mile proximity around Bristol TN + 40-mile proximity around Kingsport TN. New Q2 campaigns already proximity-based ✓.

---

## Medium (fix within 30 days)

### M1 — Add EXACT-match keywords on top intent terms [G32]
Add EXACT for: `[body shop near me]`, `[auto body repair near me]`, `[collision repair near me]`, `[auto body shop near me]`, `[wallace collision]`, `[wallace collision center]`.

### M2 — Refresh ads to GOOD/EXCELLENT strength [G40, G41]
**Action:**
- 3 RSAs per ad group minimum
- 15 headlines, 4 descriptions per RSA
- Include OEM-certification badges in headlines
- Rewrite POOR-strength ads in Range Rover Collision Repair ad group
- Pin headline 1 = "Wallace Collision Center", pin headline 2 = service intent, leave 3+ unpinned for learning

### M3 — Add conversion value to lead actions [G07]
Assign monetary value:
- Form submit: $300
- Phone call lead: $250
- Qualify_lead: $400
Then switch high-volume campaigns to MAX_CONV_VALUE with tROAS target.

### M4 — Pause QS1–2 broad keywords [G33]
Pause and re-add as PHRASE / EXACT after landing-page fix:
- `paint body shop near me` (QS1, PHRASE)
- `collision center near me` (QS2)
- `tesla certified shop` (QS2)
- `tesla approved body shops near me` (QS2)
- `tesla auto body shops near me` (QS2)
- `tesla repair near me` (QS2, PHRASE)
- `+body +shop +near +me` (QS2, PHRASE)
- `collision repair near me` (QS2)

### M5 — DSA campaign decision [G25]
`Search General` has DSA ad group with $10/d, zero spend, MAX_CONV_VALUE. Either:
- Enable with proper page feed (collision service pages only), or
- Remove.

### M6 — Mobile bid modifier verification [G54]
36 device criteria exist — verify mobile bid adjustment is ≥+15% (collision drives mobile-call intent).

---

## Low (backlog)

- **L1** Clean 18 duplicate / removed campaign budgets [G22] (cosmetic).
- **L2** Remove `primary_for_goal=true` from REMOVED CROToolkit actions (cosmetic) [G06].
- **L3** Remove 224 zero-impression keywords across paused-non-removed ad groups (housekeeping).
- **L4** Investigate "Search General" geo target 1025930 (unknown) [G52].

---

## Migration sequence (recommended order)

1. **Day 0:** C1 + C2 + C3
2. **Day 1:** H2 (landing page) starts; H1 (brand) goes live
3. **Day 3:** H4 standardize bidding on new Q2 campaigns
4. **Day 5:** H3 enable new Q2 campaigns alongside legacy
5. **Day 7:** H5 swap legacy geos to proximity
6. **Day 14–21:** monitor learning; pause legacy after Q2 hits 30+ conversions per campaign
7. **Day 30:** M1–M6
