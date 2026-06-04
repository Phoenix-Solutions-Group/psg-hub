"""Fix Wallace Collision Center conversion tracking.

Problem: the 'Landing Page' action (ID 519845175) is categorized as SUBMIT_LEAD_FORM
but fires on landing-page load, counted MANY_PER_CLICK, flagged primary_for_goal.
Smart Bidding is optimizing toward page loads, not leads.

Fix (this script):
  1. Landing Page (519845175): set include_in_conversions_metric=False,
     counting_type=ONE_PER_CLICK.
  2. Form (7258748556): set counting_type=ONE_PER_CLICK.

Does NOT touch (requires separate flow):
  - primary_for_goal — removing from primary goal requires CustomerConversionGoal
    mutations, handled in a separate op script.
  - GA4 hidden actions (qualify_lead etc.) — unhiding requires different service.

Usage:
    # Dry run (default)
    python -m ops.wallace.fix_landing_page --customer-id 6048611995

    # Actually mutate
    python -m ops.wallace.fix_landing_page --customer-id 6048611995 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.conversion_actions import (
    ConversionActionChange,
    apply_changes,
    changes_to_dicts,
    fetch_state,
    state_to_dicts,
)

OP_NAME = "wallace-fix-landing-page"

LANDING_PAGE_ID = 519845175
FORM_ID = 7258748556

CHANGES = [
    ConversionActionChange(
        conversion_action_id=LANDING_PAGE_ID,
        include_in_conversions_metric=False,
        counting_type="ONE_PER_CLICK",
    ),
    ConversionActionChange(
        conversion_action_id=FORM_ID,
        counting_type="ONE_PER_CLICK",
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually mutate. Default is dry-run.",
    )
    args = parser.parse_args()

    client = load_client()
    ids = [c.conversion_action_id for c in CHANGES]

    print(f"[1/3] Reading current state for customer {args.customer_id}...")
    before = fetch_state(client, args.customer_id, ids)
    for s in before:
        print(
            f"  id={s.id} name={s.name!r} "
            f"include_in_metric={s.include_in_conversions_metric} "
            f"counting={s.counting_type} primary={s.primary_for_goal}"
        )

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        deltas = {k: v for k, v in vars(c).items() if k != "conversion_action_id" and v is not None}
        print(f"  id={c.conversion_action_id}: {deltas}")

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
            f"  id={s.id} name={s.name!r} "
            f"include_in_metric={s.include_in_conversions_metric} "
            f"counting={s.counting_type}"
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
