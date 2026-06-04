"""Phase 5.1 — Set DESKTOP -25% device bid modifier on Tedesco search campaigns.

Audit data (last 30 days):
  Mobile:  $2,240 spend, 78 conv, $28.71 CPA
  Desktop: $780 spend,   11 conv, $70.87 CPA  (2.5x mobile)
  Tablet:  $60 spend,    3 conv,  $20.10 CPA

Desktop runs 2.5x mobile CPA. Worth dampening when tCPA is active.

IMPORTANT: This script is documented intent — Google Ads ignores standard
device bid modifiers under MAXIMIZE_CONVERSIONS (no tCPA). The current state
of all 4 search campaigns is MAX_CONV. The modifier becomes active when
tCPA layers in at Day 14 decision gate.

Setting -25% (bid_modifier=0.75) on the DESKTOP criterion for all 4 active
search campaigns. Smart Campaign untouched (different bidding surface).

Reversible: re-run with bid_modifier=1.0 to clear.

Usage:
    python -m ops.tedesco.set_device_bid_modifiers --customer-id 7763526490
    python -m ops.tedesco.set_device_bid_modifiers --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.campaign_device_bids import (
    DeviceBidModChange,
    apply_changes,
    changes_to_dicts,
    fetch_state,
    state_to_dicts,
)

OP_NAME = "tedesco-set-device-bid-modifiers"

ACTIVE_SEARCH_CAMPAIGNS: list[tuple[int, str]] = [
    (22904042869, "Insurance-Focused Family Commuter"),
    (22904043352, "Quality-Driven Luxury Owner"),
    (22904043355, "Budget-Conscious Urban Driver"),
    (22904043358, "EV Owners"),
]

DESKTOP_BID_MOD = 0.75  # -25%

CHANGES = [
    DeviceBidModChange(
        campaign_id=cid,
        device="DESKTOP",
        bid_modifier=DESKTOP_BID_MOD,
    )
    for cid, _ in ACTIVE_SEARCH_CAMPAIGNS
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()
    target_ids = [cid for cid, _ in ACTIVE_SEARCH_CAMPAIGNS]

    print(f"[1/3] Reading DEVICE criteria for {len(target_ids)} campaigns on {args.customer_id}...")
    before = fetch_state(client, args.customer_id, target_ids)
    for s in before:
        print(
            f"  campaign={s.campaign_id} ({s.campaign_name!r}) "
            f"device={s.device} bid_modifier={s.bid_modifier}"
        )

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        pct = (c.bid_modifier - 1.0) * 100
        print(
            f"  campaign={c.campaign_id} device={c.device} "
            f"bid_modifier -> {c.bid_modifier} ({pct:+.0f}%)"
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
        print(
            f"  updated campaign={r['campaign_id']} device={r['device']} "
            f"bid_modifier={r['bid_modifier']} fields={r['updated_fields']}"
        )

    after = fetch_state(client, args.customer_id, target_ids)
    print("\nPost-mutation state:")
    for s in after:
        print(
            f"  campaign={s.campaign_id} ({s.campaign_name!r}) "
            f"device={s.device} bid_modifier={s.bid_modifier}"
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
