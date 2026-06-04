"""
Fix qualify_lead conversion action for Wallace Collision Center.

Problems:
  - category = OTHER (not an account-default goal → "Included in account-level goals: No")
  - primary_for_goal = False

Fix:
  - category → SUBMIT_LEAD_FORM  (makes it an account-default goal)
  - primary_for_goal → True

Run: python fix_qualify_lead_category.py --dry-run
Run: python fix_qualify_lead_category.py
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.client import load_client

CUSTOMER_ID = "6048611995"
QUALIFY_LEAD_ID = 7194760257


def fetch_current(client) -> None:
    ga_service = client.get_service("GoogleAdsService")
    query = f"""
        SELECT
          conversion_action.id,
          conversion_action.name,
          conversion_action.category,
          conversion_action.primary_for_goal,
          conversion_action.include_in_conversions_metric,
          conversion_action.status
        FROM conversion_action
        WHERE conversion_action.id = {QUALIFY_LEAD_ID}
    """
    for row in ga_service.search(customer_id=CUSTOMER_ID, query=query):
        ca = row.conversion_action
        print(f"  [{ca.id}] {ca.name}")
        print(f"    category={ca.category.name} | primary={ca.primary_for_goal} "
              f"| in_metric={ca.include_in_conversions_metric} | status={ca.status.name}")


def apply_fix(client, dry_run: bool) -> None:
    ca_service = client.get_service("ConversionActionService")
    op = client.get_type("ConversionActionOperation")
    ca = op.update
    ca.resource_name = ca_service.conversion_action_path(CUSTOMER_ID, QUALIFY_LEAD_ID)
    ca.category = client.enums.ConversionActionCategoryEnum.SUBMIT_LEAD_FORM
    ca.primary_for_goal = True

    from google.protobuf import field_mask_pb2
    op.update_mask.CopyFrom(
        field_mask_pb2.FieldMask(paths=["category", "primary_for_goal"])
    )

    if dry_run:
        print("\n[DRY RUN] Would update qualify_lead:")
        print("  category → SUBMIT_LEAD_FORM")
        print("  primary_for_goal → True")
        return

    resp = ca_service.mutate_conversion_actions(
        customer_id=CUSTOMER_ID, operations=[op]
    )
    print(f"\n[OK] {resp.results[0].resource_name}")
    print("  category → SUBMIT_LEAD_FORM")
    print("  primary_for_goal → True")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    client = load_client()

    print("=== Current State ===")
    fetch_current(client)

    if args.dry_run:
        apply_fix(client, dry_run=True)
        print("\nRe-run without --dry-run to apply.")
        return

    print("\n=== Applying Fix ===")
    apply_fix(client, dry_run=False)

    print("\n=== Post-Fix State ===")
    fetch_current(client)
    print("\nDone. qualify_lead is now SUBMIT_LEAD_FORM category + Primary.")
    print("Allow 10-15 min for Google Ads UI to reflect the change.")


if __name__ == "__main__":
    main()
