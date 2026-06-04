"""Phase 3c — Add Tedesco certification sitelinks at account level.

Problem: 5 existing account-level sitelinks (Contact Us, Electric Vehicle
Service, Customer Testimonials, Certifications, About Us) have NO descriptions
(description1 / description2 are blank). Sitelinks with descriptions get
significantly higher impression share + CTR than those without. Also missing
direct deep-links to high-value services (Tesla Repair, Porsche Repair,
free Estimate).

Fix: add 3 new sitelinks at customer level, each with description1 +
description2. Account-level — inherits to all 5 campaigns.

Existing 5 sitelinks remain (Google rotates from a larger pool).

URL note: link_text <=25 chars, description1/2 <=35 chars each. Tedesco URL
paths verified live in initial reconnaissance via existing customer_asset.

Usage:
    python -m ops.tedesco.add_certification_sitelinks --customer-id 7763526490
    python -m ops.tedesco.add_certification_sitelinks --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.assets import (
    SitelinkSpec,
    create_sitelink_assets,
    link_assets_to_customer,
    spec_to_dict,
)

OP_NAME = "tedesco-add-certification-sitelinks"

SITELINK_SPECS = [
    SitelinkSpec(
        link_text="Schedule Estimate",
        final_url="https://www.tedescoautobody.com/contact/",
        description1="Free Estimate, Mobile Avail",
        description2="OEM Parts. Lifetime Warranty.",
    ),
    SitelinkSpec(
        link_text="Tesla Approved Repair",
        final_url="https://www.tedescoautobody.com/certifications/",
        description1="Certified Tesla Body Shop",
        description2="EV Battery Aware Aluminum",
    ),
    SitelinkSpec(
        link_text="Porsche Certified",
        final_url="https://www.tedescoautobody.com/certifications/",
        description1="Porsche Approved Repair",
        description2="OEM Parts Factory Standards",
    ),
]


def _validate(specs: list[SitelinkSpec]) -> None:
    for spec in specs:
        if len(spec.link_text) > 25:
            raise ValueError(
                f"link_text {spec.link_text!r} is {len(spec.link_text)} chars (max 25)"
            )
        if len(spec.description1) > 35:
            raise ValueError(
                f"description1 {spec.description1!r} is {len(spec.description1)} chars (max 35)"
            )
        if len(spec.description2) > 35:
            raise ValueError(
                f"description2 {spec.description2!r} is {len(spec.description2)} chars (max 35)"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    _validate(SITELINK_SPECS)

    client = load_client()

    print(f"[1/2] Planned changes:")
    for spec in SITELINK_SPECS:
        print(
            f"  Create SITELINK: {spec.link_text!r}\n"
            f"    desc1={spec.description1!r}\n"
            f"    desc2={spec.description2!r}\n"
            f"    url={spec.final_url}"
        )
    print(
        f"\n  Link {len(SITELINK_SPECS)} sitelinks to account "
        f"(CustomerAsset, field_type=SITELINK)"
    )

    if not args.execute:
        print("\n[2/2] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={"existing_account_sitelinks": 5},
            changes={"specs": [spec_to_dict(s) for s in SITELINK_SPECS]},
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[2/2] EXECUTING...")
    asset_ids = create_sitelink_assets(client, args.customer_id, SITELINK_SPECS)
    print(f"  Created SITELINK asset_ids: {asset_ids}")

    links = link_assets_to_customer(
        client, args.customer_id, asset_ids, field_type="SITELINK"
    )
    for spec, link in zip(SITELINK_SPECS, links):
        print(
            f"  Linked asset_id={link['asset_id']} ({spec.link_text!r}) "
            f"-> {link['resource_name']}"
        )

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={"existing_account_sitelinks": 5},
        changes={
            "specs": [spec_to_dict(s) for s in SITELINK_SPECS],
            "created_asset_ids": asset_ids,
            "customer_asset_links": links,
        },
        after={"new_account_sitelink_asset_ids": asset_ids},
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
