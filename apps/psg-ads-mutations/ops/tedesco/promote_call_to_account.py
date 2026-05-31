"""Phase 3a — Promote Tedesco phone CALL asset to account level.

Problem: phone CALL asset exists only on the Smart Campaign (asset.id=145051031760,
'(914) 636-3000'). The 4 active search campaigns have NO call extension, so
mobile users can't tap-to-call directly from the ad.

Fix: create a fresh CALL asset at account level (CustomerAsset). All 5 campaigns
(Smart + 4 search) inherit it. Reversible — CustomerAsset link can be set to
REMOVED later if needed.

Why a fresh asset instead of relinking 145051031760: linking the Smart Campaign's
CampaignAsset asset to CustomerAsset would conflict with its existing campaign-
level link. Creating a fresh CALL asset is cleaner and lets us verify it
independently.

Usage:
    python -m ops.tedesco.promote_call_to_account --customer-id 7763526490
    python -m ops.tedesco.promote_call_to_account --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.assets import (
    CallSpec,
    create_call_assets,
    link_assets_to_customer,
    spec_to_dict,
)

OP_NAME = "tedesco-promote-call-to-account"

TEDESCO_PHONE = "(914) 636-3000"
CALL_SPECS = [CallSpec(phone_number=TEDESCO_PHONE, country_code="US")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()

    print(f"[1/2] Planned changes:")
    for spec in CALL_SPECS:
        print(f"  Create CALL asset: phone={spec.phone_number!r} country={spec.country_code}")
    print(f"  Link to account (CustomerAsset, field_type=CALL)")

    if not args.execute:
        print("\n[2/2] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={"existing": "smart_campaign_only_call_asset_145051031760"},
            changes={"specs": [spec_to_dict(s) for s in CALL_SPECS]},
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[2/2] EXECUTING...")
    asset_ids = create_call_assets(client, args.customer_id, CALL_SPECS)
    print(f"  Created CALL asset_ids: {asset_ids}")

    links = link_assets_to_customer(
        client, args.customer_id, asset_ids, field_type="CALL"
    )
    for link in links:
        print(f"  Linked asset_id={link['asset_id']} -> {link['resource_name']}")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={"existing": "smart_campaign_only_call_asset_145051031760"},
        changes={
            "specs": [spec_to_dict(s) for s in CALL_SPECS],
            "created_asset_ids": asset_ids,
            "customer_asset_links": links,
        },
        after={"new_account_level_call_asset_ids": asset_ids},
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
