"""Phase 3d — Upload Tedesco business logo at account level.

Problem: 4 active search campaigns had BUSINESS_LOGO=REMOVED in earlier audit.
Account has no customer-level BUSINESS_LOGO asset. Without a logo, RSAs render
without brand recognition signal in mobile feed surfaces.

Source: square logo at
  ~/Library/CloudStorage/.../Tedesco Auto Body/Logo/Vector Logo_Tedesco 002B-01.png
  Dimensions: 2918x2918 (1:1, under 5120x5120 max)
  File size: ~105KB (under 5MB max)

Fix: upload PNG bytes inline via Asset.image_asset.data, link via
CustomerAsset with field_type=BUSINESS_LOGO. Inherits to all 5 campaigns.

Not handled here: LANDSCAPE_LOGO (4:1 ratio required; closest available is
2.84:1 which Google would reject). Skip until designer produces a 4:1 crop.

Usage:
    python -m ops.tedesco.add_business_logo --customer-id 7763526490
    python -m ops.tedesco.add_business_logo --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.assets import (
    ImageSpec,
    create_image_assets,
    link_assets_to_customer,
)

OP_NAME = "tedesco-add-business-logo"

LOGO_PATH = Path(
    "/Users/schoolcraft_mbpro/Library/CloudStorage/"
    "GoogleDrive-nick@phoenixsolutionsgroup.net/Shared drives/"
    "[1] PSG Team Drive/Clients Q-T/Tedesco Auto Body/Logo/"
    "Vector Logo_Tedesco 002B-01.png"
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    parser.add_argument(
        "--logo-path",
        default=str(LOGO_PATH),
        help="Override path to PNG/JPG logo file",
    )
    args = parser.parse_args()

    logo_path = Path(args.logo_path)
    if not logo_path.exists():
        print(f"ERROR: logo file not found at {logo_path}", file=sys.stderr)
        return 2
    data = logo_path.read_bytes()
    size_bytes = len(data)
    print(f"[1/3] Logo file: {logo_path.name}")
    print(f"  size_bytes={size_bytes:,} ({size_bytes / 1024:.1f} KB)")
    if size_bytes > 5 * 1024 * 1024:
        print(f"ERROR: file exceeds 5MB limit ({size_bytes} bytes)", file=sys.stderr)
        return 2

    suffix = logo_path.suffix.lower()
    mime_type = {
        ".png": "IMAGE_PNG",
        ".jpg": "IMAGE_JPEG",
        ".jpeg": "IMAGE_JPEG",
        ".gif": "IMAGE_GIF",
    }.get(suffix)
    if mime_type is None:
        print(f"ERROR: unsupported file extension {suffix!r}", file=sys.stderr)
        return 2

    spec = ImageSpec(
        data=data,
        name="Tedesco Auto Body — Square Logo",
        mime_type=mime_type,
    )

    client = load_client()

    print(f"\n[2/3] Planned changes:")
    print(f"  Create IMAGE asset ({mime_type}, {size_bytes:,} bytes)")
    print(f"  Link to account (CustomerAsset, field_type=BUSINESS_LOGO)")

    if not args.execute:
        print("\n[3/3] DRY RUN — no changes made. Pass --execute to apply.")
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before={"existing_account_business_logo": None},
            changes={
                "source_file": str(logo_path),
                "size_bytes": size_bytes,
                "mime_type": mime_type,
                "asset_name": spec.name,
            },
            after=None,
            dry_run=True,
        )
        print(f"Audit log: {path}")
        return 0

    print("\n[3/3] EXECUTING...")
    asset_ids = create_image_assets(client, args.customer_id, [spec])
    print(f"  Created IMAGE asset_ids: {asset_ids}")

    links = link_assets_to_customer(
        client, args.customer_id, asset_ids, field_type="BUSINESS_LOGO"
    )
    for link in links:
        print(f"  Linked asset_id={link['asset_id']} -> {link['resource_name']}")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before={"existing_account_business_logo": None},
        changes={
            "source_file": str(logo_path),
            "size_bytes": size_bytes,
            "mime_type": mime_type,
            "created_asset_ids": asset_ids,
            "customer_asset_links": links,
        },
        after={"new_account_business_logo_asset_ids": asset_ids},
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
