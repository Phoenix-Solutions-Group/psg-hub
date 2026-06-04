"""Phase 3e — Replace 6 Tedesco sitelinks with description-enriched versions.

Problem: 6 customer-level SITELINK assets need upgrade:
  - 5 pre-existing have no descriptions (sitelinks with desc1/desc2 serve
    more often + lift CTR).
  - 1 Phase 3c sitelink 'Schedule Estimate' points to /contact/, but every
    RSA in the 4 search campaigns lands on /start-estimate/. Mismatched
    surface — destination should match.

Sitelink content is immutable on link_text/url/descriptions. Pattern:
  1. Create 6 new SITELINK Assets (with descriptions).
  2. Link new assets via CustomerAsset (account-level).
  3. Remove the 6 old CustomerAsset links (underlying Assets remain in
     account for history; just unlinked).

Net effect: account-level SITELINK count remains 8 (3 cert + 5 upgraded).
The 3 cert sitelinks from Phase 3c (Tesla Approved, Porsche Certified) are
untouched. The 'Schedule Estimate' cert sitelink (Phase 3c) gets re-pointed.

Usage:
    python -m ops.tedesco.upgrade_sitelinks --customer-id 7763526490
    python -m ops.tedesco.upgrade_sitelinks --customer-id 7763526490 --execute
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
    remove_customer_asset_links,
    spec_to_dict,
)

OP_NAME = "tedesco-upgrade-sitelinks"

# Old customer_asset link resource names to remove after replacement.
# Format: customers/{cid}/customerAssets/{asset_id}~{field_type}
OLD_LINKS_TO_REMOVE = [
    # 5 pre-existing description-less sitelinks
    "customers/{cid}/customerAssets/23788416797~SITELINK",  # Contact Us
    "customers/{cid}/customerAssets/23788416803~SITELINK",  # Electric Vehicle Service
    "customers/{cid}/customerAssets/23788416809~SITELINK",  # Customer Testimonials
    "customers/{cid}/customerAssets/23788416815~SITELINK",  # Certifications
    "customers/{cid}/customerAssets/23788416821~SITELINK",  # About Us
    # 1 Phase 3c sitelink with wrong URL
    "customers/{cid}/customerAssets/360176158804~SITELINK",  # Schedule Estimate -> /contact/ (wrong)
]

# Replacement sitelinks. Each <=25 char link_text, <=35 char descs.
NEW_SITELINKS = [
    SitelinkSpec(
        link_text="Contact Us",
        final_url="https://www.tedescoautobody.com/contact/",
        description1="Call (914) 636-3000",
        description2="Open Mon-Sat for Estimates",
    ),
    SitelinkSpec(
        link_text="Electric Vehicle Service",
        final_url="https://www.tedescoautobody.com/electric-vehicle-service/",
        description1="Tesla, Rivian, Porsche Certified",
        description2="OEM Parts. Battery Aware.",
    ),
    SitelinkSpec(
        link_text="Customer Testimonials",
        final_url="https://www.tedescoautobody.com/customer-reviews/",
        description1="5-Star Westchester Reviews",
        description2="Real Customer Stories",
    ),
    SitelinkSpec(
        link_text="Certifications",
        final_url="https://www.tedescoautobody.com/certifications/",
        description1="Tesla, Porsche, Rivian Certified",
        description2="OEM Parts. Lifetime Warranty.",
    ),
    SitelinkSpec(
        link_text="About Us",
        final_url="https://www.tedescoautobody.com/about-us/",
        description1="Trusted Westchester Body Shop",
        description2="OEM Certified Repairs",
    ),
    SitelinkSpec(
        link_text="Schedule Estimate",
        final_url="https://www.tedescoautobody.com/start-estimate/",
        description1="Free Estimate, Mobile Avail",
        description2="OEM Parts. Lifetime Warranty.",
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

    _validate(NEW_SITELINKS)

    old_links = [rn.format(cid=args.customer_id) for rn in OLD_LINKS_TO_REMOVE]

    client = load_client()

    print(f"[1/4] Planned creates ({len(NEW_SITELINKS)} new sitelinks):")
    for spec in NEW_SITELINKS:
        print(
            f"  {spec.link_text!r} -> {spec.final_url}\n"
            f"    desc1={spec.description1!r}\n"
            f"    desc2={spec.description2!r}"
        )

    print(f"\n[2/4] Planned removals ({len(old_links)} old customer_asset links):")
    for rn in old_links:
        print(f"  {rn}")

    if not args.execute:
        print("\n[3-4/4] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={"old_links_to_remove": old_links},
            changes={
                "new_specs": [spec_to_dict(s) for s in NEW_SITELINKS],
                "remove_after_replacement": old_links,
            },
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[3/4] EXECUTING — create + link new sitelinks...")
    new_asset_ids = create_sitelink_assets(client, args.customer_id, NEW_SITELINKS)
    print(f"  Created SITELINK asset_ids: {new_asset_ids}")

    new_links = link_assets_to_customer(
        client, args.customer_id, new_asset_ids, field_type="SITELINK"
    )
    for spec, link in zip(NEW_SITELINKS, new_links):
        print(
            f"  Linked asset_id={link['asset_id']} ({spec.link_text!r}) "
            f"-> {link['resource_name']}"
        )

    print(f"\n[4/4] EXECUTING — remove {len(old_links)} old customer_asset links...")
    removed = remove_customer_asset_links(client, args.customer_id, old_links)
    for r in removed:
        print(f"  Removed {r['removed_resource_name']}")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={"old_links_to_remove": old_links},
        changes={
            "new_specs": [spec_to_dict(s) for s in NEW_SITELINKS],
            "new_asset_ids": new_asset_ids,
            "new_customer_asset_links": new_links,
            "removed_old_links": removed,
        },
        after={
            "new_sitelink_asset_ids": new_asset_ids,
        },
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
