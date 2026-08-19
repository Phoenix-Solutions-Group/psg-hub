# PSG-2059 Customer Inventory Dry Run

Generated: 2026-07-17T15:38:23.909Z

## Bottom line

This was a dry run only. No Pipedrive, Invoiced, FileMaker, or Supabase records were changed.

The inventory found 37,003 customer/source rows across FileMaker, Invoiced-derived Supabase tables, Supabase shop/location tables, Google Business Profile address data, and live Pipedrive organizations. It produced 33 proposed safe blank-field fills and 15,375 rows that need human review before any write-back.

## Counts

| Measure | Count |
| --- | ---: |
| Pipedrive organizations read | 2,493 |
| Source rows after aggregation | 37,003 |
| Matched rows | 7,788 |
| Unmatched rows | 29,215 |
| Safe blank-field fills | 33 |
| Already-current field checks | 5,868 |
| Existing conflicts / possible stale values | 14,350 |
| Human-review action rows | 15,375 |

## Proposed next step

Approve a reviewed write-back pass only for the safe blank-field fills after Tess samples the CSV. Do not approve overwrites yet. Address conflicts, name-only matches, fuzzy matches, and unmatched records should stay in manual review because they may represent duplicate locations, stale addresses, or different shops with similar names.

## Output files

- `psg2059_customer_inventory_all.csv`
- `psg2059_pipedrive_standardization_actions.csv`
- `psg2059_safe_blank_fills.csv`
- `psg2059_review_holds.csv`
- `psg2059_customer_inventory_summary.json`

## Guardrails used

- No live writes.
- Existing Pipedrive values are never overwritten in the safe-fill bucket.
- Website values are stripped of campaign/referral tracking before they can remain in the safe-fill bucket.
- Exact PSG ID is the strongest match.
- Exact phone or website matches require a close organization-name match before a blank field is considered safe.
- Name-only, fuzzy, duplicate, ambiguous, and address-conflict rows require human review.
