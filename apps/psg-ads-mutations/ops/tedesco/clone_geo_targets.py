"""Phase 2.3 — Clone Smart Campaign geo targets to Tedesco search campaigns.

Problem: 4 active search campaigns (Insurance, Luxury, Budget, EV) have ZERO
LOCATION criteria. They're running on the account-level default, which means
they may be serving outside Tedesco's NYC-metro / Westchester / Fairfield
service area. Combined with rank-lost IS 83-89%, geo misalignment likely
drives both wasted spend and low impression share where ads SHOULD show.

Smart Campaign (20834950785) has 13 curated LOCATION targets:
  Cities (10): Greenwich CT, Stamford CT, Armonk NY, Larchmont NY,
               Mamaroneck NY, Pleasantville NY, Rye NY, Scarsdale NY,
               Thornwood NY, White Plains NY
  Counties (2): Bronx County NY, Westchester County NY
  Borough (1):  Manhattan NY

Fix: read Smart Campaign LOCATION criteria at runtime, add the same set to
each of the 4 active search campaigns. Skip dupes if any exist.

Does NOT touch the Smart Campaign itself.
Does NOT touch language targeting, ad scheduling, or PROXIMITY radius.

Usage:
    python -m ops.tedesco.clone_geo_targets --customer-id 7763526490
    python -m ops.tedesco.clone_geo_targets --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.geo_targets import (
    add_campaign_locations,
    fetch_campaign_locations,
    fetch_geo_names,
    state_to_dicts,
)

OP_NAME = "tedesco-clone-geo-targets"

SMART_CAMPAIGN_ID = 20834950785

ACTIVE_SEARCH_CAMPAIGNS: list[tuple[int, str]] = [
    (22904042869, "Insurance-Focused Family Commuter"),
    (22904043352, "Quality-Driven Luxury Owner"),
    (22904043355, "Budget-Conscious Urban Driver"),
    (22904043358, "EV Owners"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()
    target_ids = [cid for cid, _ in ACTIVE_SEARCH_CAMPAIGNS]

    print(f"[1/4] Reading Smart Campaign ({SMART_CAMPAIGN_ID}) LOCATION criteria...")
    smart_locs = fetch_campaign_locations(client, args.customer_id, [SMART_CAMPAIGN_ID])
    smart_geo_ids = sorted({s.geo_target_id for s in smart_locs})
    print(f"  {len(smart_geo_ids)} geo targets on Smart Campaign")

    print("\n  Resolving geo names...")
    geo_names = fetch_geo_names(client, args.customer_id, smart_geo_ids)
    for gid in smart_geo_ids:
        g = geo_names.get(gid)
        if g:
            print(f"    {gid}: {g.canonical_name} ({g.target_type})")
        else:
            print(f"    {gid}: (name unresolved)")

    print(f"\n[2/4] Reading existing LOCATION criteria on {len(target_ids)} target campaigns...")
    existing = fetch_campaign_locations(client, args.customer_id, target_ids)
    existing_by_campaign: dict[int, set[int]] = {cid: set() for cid in target_ids}
    for e in existing:
        existing_by_campaign[e.campaign_id].add(e.geo_target_id)
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        cnt = len(existing_by_campaign[cid])
        print(f"  id={cid} name={name!r}: {cnt} existing LOCATION criteria")

    print(f"\n[3/4] Computing per-campaign additions (skip dupes)...")
    plan: dict[int, list[int]] = {}
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        existing_set = existing_by_campaign[cid]
        to_add = [gid for gid in smart_geo_ids if gid not in existing_set]
        plan[cid] = to_add
        print(f"  id={cid} name={name!r}: +{len(to_add)} geo targets queued")

    total_ops = sum(len(v) for v in plan.values())
    print(f"\n  Total mutation ops planned: {total_ops}")

    if not args.execute:
        print("\n[4/4] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={
                "smart_campaign_id": SMART_CAMPAIGN_ID,
                "smart_geo_ids": smart_geo_ids,
                "smart_geo_names": {
                    str(g.geo_target_id): g.canonical_name
                    for g in geo_names.values()
                },
                "existing": state_to_dicts(existing),
            },
            changes={
                "per_campaign_additions": {str(cid): negs for cid, negs in plan.items()},
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
        results = add_campaign_locations(client, args.customer_id, cid, to_add)
        all_results.extend(results)
        print(f"  id={cid} name={name!r}: added {len(results)} geo targets")

    after = fetch_campaign_locations(client, args.customer_id, target_ids)
    after_by_campaign: dict[int, int] = {cid: 0 for cid in target_ids}
    for e in after:
        after_by_campaign[e.campaign_id] = after_by_campaign.get(e.campaign_id, 0) + 1
    print("\nPost-mutation LOCATION counts:")
    for cid, name in ACTIVE_SEARCH_CAMPAIGNS:
        print(f"  id={cid} name={name!r}: {after_by_campaign[cid]} total geo targets")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={
            "smart_geo_ids": smart_geo_ids,
            "existing_target_counts": {
                str(cid): len(existing_by_campaign[cid]) for cid in target_ids
            },
        },
        changes={"applied": all_results},
        after={
            "target_counts": {str(cid): after_by_campaign[cid] for cid in target_ids},
        },
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
