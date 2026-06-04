"""Phase 2.1 — Switch Tedesco active search campaigns to Maximize Conversions.

Problem: 4 active search campaigns use TARGET_SPEND (Maximize Clicks). That
strategy chases volume with no CPA control, while every campaign is reporting
real conversions ($82-$240 CPA, search-only). For lead-gen with phone + form
goals, the correct strategy is Maximize Conversions (no tCPA yet — let the
system relearn for 2 weeks before layering a target).

Fix: flip bidding_strategy on 4 campaigns from TARGET_SPEND to
MAXIMIZE_CONVERSIONS. Reversible. After 15+ conv per campaign in trailing 14d,
layer tCPA via separate script.

Usage:
    python -m ops.tedesco.switch_bidding_max_conv --customer-id 7763526490
    python -m ops.tedesco.switch_bidding_max_conv --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.campaign_bidding import (
    CampaignBiddingChange,
    apply_changes,
    changes_to_dicts,
    fetch_state,
    state_to_dicts,
)

OP_NAME = "tedesco-switch-bidding-max-conv"

ACTIVE_SEARCH_CAMPAIGNS: list[tuple[int, str]] = [
    (22904042869, "Insurance-Focused Family Commuter"),
    (22904043352, "Quality-Driven Luxury Owner"),
    (22904043355, "Budget-Conscious Urban Driver"),
    (22904043358, "EV Owners"),
]

CHANGES = [
    CampaignBiddingChange(
        campaign_id=cid,
        strategy="MAXIMIZE_CONVERSIONS",
        target_cpa_micros=0,  # no tCPA — relearn first
    )
    for cid, _ in ACTIVE_SEARCH_CAMPAIGNS
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()
    ids = [c.campaign_id for c in CHANGES]

    print(f"[1/3] Reading bidding state for {len(ids)} campaigns on {args.customer_id}...")
    before = fetch_state(client, args.customer_id, ids)
    for s in before:
        print(
            f"  id={s.campaign_id} name={s.name!r} status={s.status} "
            f"strategy={s.bidding_strategy_type}\n"
            f"    target_cpa_micros={s.target_cpa_micros} "
            f"max_conv_tcpa_micros={s.maximize_conversions_target_cpa_micros}"
        )

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        print(
            f"  id={c.campaign_id}: bidding -> {c.strategy} "
            f"(target_cpa_micros={c.target_cpa_micros})"
        )

    if not args.execute:
        print("\n[3/3] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before=state_to_dicts(before),
            changes=changes_to_dicts(CHANGES),
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[3/3] EXECUTING...")
    results = apply_changes(client, args.customer_id, CHANGES)
    for r in results:
        print(f"  updated id={r['campaign_id']} fields={r['updated_fields']}")

    after = fetch_state(client, args.customer_id, ids)
    print("\nPost-mutation state:")
    for s in after:
        print(
            f"  id={s.campaign_id} strategy={s.bidding_strategy_type} "
            f"max_conv_tcpa_micros={s.maximize_conversions_target_cpa_micros}"
        )

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before=state_to_dicts(before),
        changes=changes_to_dicts(CHANGES),
        after=state_to_dicts(after),
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
