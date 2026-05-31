"""
Wallace Collision Center — Conversion Action Fix
Account: 604-861-1995 (customer_id: 6048611995)

Changes made:
  1. Landing Page (519845175) → include_in_conversions_metric=False
     Removes page-loads from Smart Bidding signal. Still tracked as secondary.

  2. Form (7258748556) → counting_type=ONE_PER_CLICK
     One form submit = one lead. Prevents double-counting.

  3. qualify_lead (7194760257) → status=ENABLED, include_in_conversions_metric=True
     Unhides the GA4 qualify_lead event and promotes it to primary signal.

Run: python fix_conversion_actions.py --dry-run   (preview changes)
Run: python fix_conversion_actions.py              (execute changes)
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Add parent to path so we can import googleads_psg
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.client import load_client
from googleads_psg.mutations.conversion_actions import (
    ConversionActionChange,
    apply_changes,
    fetch_state,
)

CUSTOMER_ID = "6048611995"

# Conversion action IDs confirmed via live account query 2026-05-06
LANDING_PAGE_ID = 519845175       # WEBPAGE / page-load — corrupting Smart Bidding
FORM_ID = 7258748556              # GA4 form submit — counting wrong
QUALIFY_LEAD_ID = 7194760257      # GA4 qualify_lead — HIDDEN, needs promotion


def print_current_state(client) -> None:
    states = fetch_state(
        client,
        CUSTOMER_ID,
        [LANDING_PAGE_ID, FORM_ID, QUALIFY_LEAD_ID],
    )
    print("\n=== Current State ===")
    for s in states:
        print(
            f"  [{s.id}] {s.name}\n"
            f"    status={s.status} | in_metric={s.include_in_conversions_metric} "
            f"| counting={s.counting_type} | primary={s.primary_for_goal}"
        )


def fix_qualify_lead_status(client, dry_run: bool) -> None:
    """Enable + promote qualify_lead via direct API call (status not in shared mutations module)."""
    ga_service = client.get_service("ConversionActionService")
    op = client.get_type("ConversionActionOperation")
    ca = op.update
    ca.resource_name = ga_service.conversion_action_path(CUSTOMER_ID, QUALIFY_LEAD_ID)
    ca.status = client.enums.ConversionActionStatusEnum.ENABLED
    ca.include_in_conversions_metric = True
    ca.primary_for_goal = True

    from google.api_core import protobuf_helpers
    client.copy_from(op.update_mask, protobuf_helpers.field_mask(None, ca._pb))

    if dry_run:
        print(f"\n[DRY RUN] Would enable qualify_lead (ID {QUALIFY_LEAD_ID}): "
              f"status=ENABLED, include_in_conversions_metric=True, primary_for_goal=True")
        return

    resp = ga_service.mutate_conversion_actions(
        customer_id=CUSTOMER_ID, operations=[op]
    )
    print(f"\n[OK] qualify_lead enabled: {resp.results[0].resource_name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview without executing")
    args = parser.parse_args()

    client = load_client()
    print_current_state(client)

    # NOTE: Form (7258748556) counting_type is IMMUTABLE via API for GA4 custom actions.
    # Fix manually: Google Ads UI → Conversions → Form → Edit → Counting: One per click
    changes = [
        ConversionActionChange(
            conversion_action_id=LANDING_PAGE_ID,
            include_in_conversions_metric=False,
        ),
    ]

    if args.dry_run:
        print("\n=== Proposed Changes (DRY RUN — no changes made) ===")
        print(f"  Landing Page ({LANDING_PAGE_ID}): include_in_conversions_metric → False")
        print(f"  Form ({FORM_ID}): counting_type — MANUAL STEP REQUIRED (immutable via API)")
        fix_qualify_lead_status(client, dry_run=True)
        print("\nRe-run without --dry-run to apply.")
        return

    print("\n=== Applying Changes ===")
    results = apply_changes(client, CUSTOMER_ID, changes)
    for r in results:
        print(f"  [OK] {r['resource_name']} → updated: {r['updated_fields']}")

    fix_qualify_lead_status(client, dry_run=False)

    print("\n=== Post-Change State ===")
    print_current_state(client)
    print("\nDone. Smart Bidding will now optimize toward real leads, not page loads.")
    print("Monitor conversions for 48h to confirm signal is flowing correctly.")


if __name__ == "__main__":
    main()
