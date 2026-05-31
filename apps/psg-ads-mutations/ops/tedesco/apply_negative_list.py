"""Phase 2.2 — Copy Smart Campaign negative keyword list to Tedesco search campaigns.

Problem: The 4 active search campaigns (Insurance, Luxury, Budget, EV) have
ZERO campaign-level negative keywords. The Smart Campaign (20834950785) has
80+ curated negatives covering general spam, insurance/loan exclusion, hobby
queries, and competitor terms. Same negatives belong on the search campaigns.

Cross-campaign cannibalization: search terms like 'auto body shop near me'
trigger all 4 persona campaigns simultaneously. Add 4 generic exact-match
negatives to force each campaign to match only persona-specific intent.

Fix: fetch all current Smart Campaign negatives at runtime, plus 4 hardcoded
cross-cannibalization exact negatives, and ADD them to each of the 4 active
search campaigns. Skips negatives that already exist on a target campaign.

Usage:
    python -m ops.tedesco.apply_negative_list --customer-id 7763526490
    python -m ops.tedesco.apply_negative_list --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.negative_keywords import (
    NegativeKeyword,
    add_campaign_negatives,
    fetch_existing_negatives,
    negatives_to_dicts,
    state_to_dicts,
)

OP_NAME = "tedesco-apply-negative-list"

SMART_CAMPAIGN_ID = 20834950785

ACTIVE_SEARCH_CAMPAIGNS: list[tuple[int, str]] = [
    (22904042869, "Insurance-Focused Family Commuter"),
    (22904043352, "Quality-Driven Luxury Owner"),
    (22904043355, "Budget-Conscious Urban Driver"),
    (22904043358, "EV Owners"),
]

# Cross-cannibalization exact-match negatives — generic queries that should
# only run in the Smart Campaign, not in any persona search campaign.
CROSS_CANNIB_NEGATIVES: list[NegativeKeyword] = [
    NegativeKeyword(text="auto body shop near me", match_type="EXACT"),
    NegativeKeyword(text="auto body near me", match_type="EXACT"),
    NegativeKeyword(text="body shop near me", match_type="EXACT"),
    NegativeKeyword(text="body shops near me", match_type="EXACT"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()
    target_ids = [cid for cid, _ in ACTIVE_SEARCH_CAMPAIGNS]

    print(
        f"[1/4] Reading Smart Campaign ({SMART_CAMPAIGN_ID}) negative keywords..."
    )
    smart_negs = fetch_existing_negatives(client, args.customer_id, [SMART_CAMPAIGN_ID])
    smart_kws = [
        NegativeKeyword(text=n.keyword_text, match_type=n.match_type)
        for n in smart_negs
    ]
    print(f"  {len(smart_kws)} negatives found on Smart Campaign")

    source_negatives = smart_kws + CROSS_CANNIB_NEGATIVES
    print(
        f"  + {len(CROSS_CANNIB_NEGATIVES)} cross-cannibalization exact negatives "
        f"= {len(source_negatives)} total candidates per campaign"
    )

    print(f"\n[2/4] Reading existing negatives on {len(target_ids)} target campaigns...")
    existing = fetch_existing_negatives(client, args.customer_id, target_ids)
    existing_by_campaign: dict[int, set[tuple[str, str]]] = {cid: set() for cid in target_ids}
    for e in existing:
        existing_by_campaign[e.campaign_id].add((e.keyword_text.lower(), e.match_type))
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        print(f"  id={cid} name={name!r}: {len(existing_by_campaign[cid])} existing negatives")

    print(f"\n[3/4] Computing per-campaign additions (skip dupes)...")
    plan: dict[int, list[NegativeKeyword]] = {}
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        existing_set = existing_by_campaign[cid]
        to_add: list[NegativeKeyword] = []
        seen: set[tuple[str, str]] = set()
        for neg in source_negatives:
            key = (neg.text.lower(), neg.match_type)
            if key in existing_set or key in seen:
                continue
            to_add.append(neg)
            seen.add(key)
        plan[cid] = to_add
        print(f"  id={cid} name={name!r}: +{len(to_add)} negatives queued")

    total_ops = sum(len(v) for v in plan.values())
    print(f"\n  Total mutation ops planned: {total_ops}")

    if not args.execute:
        print("\n[4/4] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={
                "smart_campaign_id": SMART_CAMPAIGN_ID,
                "smart_neg_count": len(smart_kws),
                "existing": [s.__dict__ for s in existing],
            },
            changes={
                "source_negatives": negatives_to_dicts(source_negatives),
                "per_campaign_additions": {
                    str(cid): negatives_to_dicts(negs) for cid, negs in plan.items()
                },
            },
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[4/4] EXECUTING...")
    all_results: list[dict] = []
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        to_add = plan[cid]
        if not to_add:
            print(f"  id={cid} name={name!r}: nothing to add")
            continue
        results = add_campaign_negatives(client, args.customer_id, cid, to_add)
        all_results.extend(results)
        print(f"  id={cid} name={name!r}: added {len(results)} negatives")

    after = fetch_existing_negatives(client, args.customer_id, target_ids)
    after_by_campaign: dict[int, int] = {cid: 0 for cid in target_ids}
    for e in after:
        after_by_campaign[e.campaign_id] = after_by_campaign.get(e.campaign_id, 0) + 1
    print("\nPost-mutation negative counts:")
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        print(f"  id={cid} name={name!r}: {after_by_campaign[cid]} total negatives")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={
            "smart_campaign_id": SMART_CAMPAIGN_ID,
            "smart_neg_count": len(smart_kws),
            "existing_target_counts": {
                str(cid): len(existing_by_campaign[cid]) for cid in target_ids
            },
        },
        changes={
            "applied": all_results,
        },
        after={
            "target_counts": {str(cid): after_by_campaign[cid] for cid in target_ids},
        },
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
