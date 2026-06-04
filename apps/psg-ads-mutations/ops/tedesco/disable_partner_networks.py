"""Phase 1.3 — Disable Search Partners + Display on Tedesco active search campaigns.

Problem: 26.7% of last-30d clicks (1,177 / 4,407) are flagged invalid. Strong
signal that low-intent traffic is coming from Google Search Partners and/or
Display Network being enabled on the 4 active Search campaigns.

Fix (this script): set network_settings.target_search_network=False and
target_content_network=False on the 4 active Search campaigns. Keep
target_google_search=True. Reversible.

The Smart Campaign (20834950785) and any paused campaigns are untouched.

Usage:
    python -m ops.tedesco.disable_partner_networks --customer-id 7763526490
    python -m ops.tedesco.disable_partner_networks --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.campaign_network import (
    CampaignNetworkChange,
    apply_changes,
    changes_to_dicts,
    fetch_state,
    state_to_dicts,
)

OP_NAME = "tedesco-disable-partner-networks"

# 4 active SEARCH campaigns. Smart Campaign (20834950785) excluded — different surface.
ACTIVE_SEARCH_CAMPAIGNS: list[tuple[int, str]] = [
    (22904042869, "Insurance-Focused Family Commuter"),
    (22904043352, "Quality-Driven Luxury Owner"),
    (22904043355, "Budget-Conscious Urban Driver"),
    (22904043358, "EV Owners"),
]

CHANGES = [
    CampaignNetworkChange(
        campaign_id=cid,
        target_search_network=False,
        target_content_network=False,
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

    print(f"[1/3] Reading network_settings for {len(ids)} campaigns on {args.customer_id}...")
    before = fetch_state(client, args.customer_id, ids)
    for s in before:
        print(
            f"  id={s.campaign_id} name={s.name!r} status={s.status}\n"
            f"    google_search={s.target_google_search} "
            f"search_partners={s.target_search_network} "
            f"display={s.target_content_network} "
            f"partner_search={s.target_partner_search_network}"
        )

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        print(
            f"  id={c.campaign_id}: search_partners -> {c.target_search_network}, "
            f"display -> {c.target_content_network}"
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
        print(f"  updated {r['resource_name']} fields={r['updated_fields']}")

    after = fetch_state(client, args.customer_id, ids)
    print("\nPost-mutation state:")
    for s in after:
        print(
            f"  id={s.campaign_id} name={s.name!r}\n"
            f"    google_search={s.target_google_search} "
            f"search_partners={s.target_search_network} "
            f"display={s.target_content_network}"
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
