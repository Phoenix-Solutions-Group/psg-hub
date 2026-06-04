# Wallace Collision — Quick Wins (<15 min, high impact)

CID `6048611995`. Each item executable today. Sorted by impact × ease.

---

## QW1 — Add OEM-generic negatives [C2]
**Time:** 10 min. **Impact:** ~$540/mo waste eliminated (~16% of spend).

In Tesla Approved, JLR Certified Collision Repairs, BMW Certified, Rivian Approved, and matching 2026Q2 campaigns, add as negative keywords (PHRASE match):

```
"dealership", "dealer", "for sale", "lease", "buy", "used",
"parts", "tires", "battery", "windshield", "ceramic coating",
"extended warranty", "service appointment", "maintenance cost",
"coupons", "accessories", "recall",
"model 3", "model y", "model s", "model x", "cybertruck",
"f pace", "vanden plas",
"2017", "2018", "2019", "2020", "2021", "2022", "2023"
```

**Verify:** rerun `search_term_view` query in 7 days; total wasted spend on zero-conv terms should drop ≥80%.

---

## QW2 — Enable brand campaign properly [H1]
**Time:** 10 min. **Impact:** +20–40 brand-search conversions/mo at ~$3 CPA.

Campaign: `GOOG_WAL_SRCH_Brand_2026Q2` (id 23825006324).

1. Change bidding from `TARGET_IMPRESSION_SHARE` to `MAXIMIZE_CLICKS` with $1.50 max CPC.
2. Raise budget from $7/d → $15/d.
3. Add EXACT keywords: `[wallace collision]`, `[wallace collision center]`, `[wallace collision center bristol]`.
4. Change status to ENABLED.

---

## QW3 — Drop `primary_for_goal` from engagement actions [C1]
**Time:** 10 min. **Impact:** Smart Bidding optimizes on real form/call leads, not map-clicks.

Run a one-off script extending `ops/wallace/fix_conversion_actions.py` to flip `primary_for_goal=false` on:
- `Local actions - Directions` (563131646)
- `Local actions - Website visits` (564340687)
- `Local actions - Other engagements` (564345007)
- `Local actions - Menu views` (7110757091)
- `Smart campaign map clicks to call` (7258467793)
- `Smart campaign map directions` (7258748397)
- `Smart campaign ad clicks to call` (7258748379)

Also flip `include_in_conversions_metric=false` on `Smart campaign ad clicks to call` (7258748379).

---

## QW4 — Switch `GA4 qualify_lead` to ONE_PER_CLICK [C1]
**Time:** 3 min. **Impact:** removes ~30% conversion inflation; bidder targets unique leads.

Conversion action id `7194760257`. Set `counting_type=ONE_PER_CLICK`.

---

## QW5 — Pause QS1 keyword `paint body shop near me` [M4]
**Time:** 1 min. **Impact:** $23/mo waste, drag on account QS.

Phrase-match keyword in PPC_Wallace_40Miles → `body shop near` ad group. Pause until landing page fixed; re-add as EXACT.

---

## QW6 — Pause Rivian Approved campaign [G34]
**Time:** 2 min. **Impact:** removes $14/d phantom budget on $60 max-CPC ad groups with zero historical conversions; eliminates confusion.

Rivian (cid 21460658316) is already PAUSED. **Mark `serving_status` clarification**: Rivian needs ad-group-level bid sanity check before any future re-enable — three ad groups at $60 max CPC.

---

## QW7 — Pause Wallace Ford Smart campaign [C3]
**Time:** 2 min. **Impact:** $264/mo recovered if mis-scoped; cleaner conversion signal.

After client confirmation only. Campaign cid 22896707513.

---

## QW8 — Activate state→proximity geo for top legacy campaigns [H5]
**Time:** 12 min. **Impact:** ~20% spend reallocated from far metros to in-radius searches.

For PPC_Wallace_40Miles, Tesla Approved, JLR Certified Collision Repairs:
- Remove location targets `200531` (TN), `200567` (VA), `200573` (KY).
- Add proximity 40 mi around Bristol, TN (and/or Kingsport, TN).

---

## Total quick-win impact (next 30 days)

| Item | Monthly $ | Quality lift |
|------|----------:|---------------|
| QW1 negatives | +$540 saved | — |
| QW2 brand | +20–40 conv | — |
| QW3 + QW4 conversion clean | — | accurate CPA reporting |
| QW5 QS1 pause | +$23 saved | +0.3 acct QS |
| QW7 Ford pause (if approved) | +$264 saved | cleaner signal |
| QW8 geo tighten | ~$200 reallocated | — |

**Estimated effective spend recovered:** ~$1,000/mo on $3,400/mo account = **30% efficiency gain** with <60 min total work.
