"""Phase 3b — Add Tedesco certification callouts at account level.

Problem: existing 5 account-level callouts are generic (Free Mobile Estimates,
Factory Trained Techs, High Standard Of Repairs, Open Mon-Sat, 100%
Satisfaction). Missing: the differentiators that match Tedesco's actual
positioning — Tesla/Porsche/Rivian certifications, OEM parts, lifetime warranty.

These match the keyword themes already running (EV Owners, Quality-Driven
Luxury, Tesla-approved keywords) and should lift CTR on persona campaigns.

Fix: add 5 cert-specific callouts at customer level (inherits to all campaigns).
Existing 5 generic callouts stay — Google rotates among them.

Usage:
    python -m ops.tedesco.add_certification_callouts --customer-id 7763526490
    python -m ops.tedesco.add_certification_callouts --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.assets import (
    CalloutSpec,
    create_callout_assets,
    link_assets_to_customer,
    spec_to_dict,
)

OP_NAME = "tedesco-add-certification-callouts"

# Each callout_text must be <=25 chars
CALLOUT_SPECS = [
    CalloutSpec(callout_text="Tesla Certified"),
    CalloutSpec(callout_text="Porsche Certified"),
    CalloutSpec(callout_text="Rivian Certified"),
    CalloutSpec(callout_text="OEM Parts Only"),
    CalloutSpec(callout_text="Lifetime Warranty"),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    # Validate lengths up front (Google rejects long callouts).
    for spec in CALLOUT_SPECS:
        if len(spec.callout_text) > 25:
            raise ValueError(
                f"callout_text {spec.callout_text!r} is {len(spec.callout_text)} chars (max 25)"
            )

    client = load_client()

    print(f"[1/2] Planned changes:")
    for spec in CALLOUT_SPECS:
        print(f"  Create CALLOUT: {spec.callout_text!r} ({len(spec.callout_text)} chars)")
    print(f"  Link {len(CALLOUT_SPECS)} callouts to account (CustomerAsset, field_type=CALLOUT)")

    if not args.execute:
        print("\n[2/2] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={"existing_account_callouts": 5},
            changes={"specs": [spec_to_dict(s) for s in CALLOUT_SPECS]},
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[2/2] EXECUTING...")
    asset_ids = create_callout_assets(client, args.customer_id, CALLOUT_SPECS)
    print(f"  Created CALLOUT asset_ids: {asset_ids}")

    links = link_assets_to_customer(
        client, args.customer_id, asset_ids, field_type="CALLOUT"
    )
    for spec, link in zip(CALLOUT_SPECS, links):
        print(
            f"  Linked asset_id={link['asset_id']} ({spec.callout_text!r}) "
            f"-> {link['resource_name']}"
        )

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={"existing_account_callouts": 5},
        changes={
            "specs": [spec_to_dict(s) for s in CALLOUT_SPECS],
            "created_asset_ids": asset_ids,
            "customer_asset_links": links,
        },
        after={"new_account_callout_asset_ids": asset_ids},
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
