"""Phase 1.2 — Stop Tedesco Auto Body from inflating reported conversion value.

Problem: 'Start Estimate Request' (495622033) has default_value=$1,620 with
always_use_default_value=True. Every estimate request is reported as $1,620 of
revenue regardless of actual job size. Last 30 days reported $124k 'conversion
value' against $3,080 spend — meaningless ROAS, and Smart Bidding (when
eventually layered) will optimize against a flat fictitious value rather than
true variation.

Fix (this script): set always_use_default_value=False on the Estimate Request
action. Keeps default_value=$1,620 in place (used only when no value supplied),
but stops back-filling every conversion with the same fake value. Reversible.

True value should come from offline conversion import once a CRM-side baseline
exists (Phase 5). Until then, optimizing on conversion *count* is cleaner than
fake value.

Usage:
    python -m ops.tedesco.fix_default_value --customer-id 7763526490
    python -m ops.tedesco.fix_default_value --customer-id 7763526490 --execute
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

OP_NAME = "tedesco-fix-default-value"

ESTIMATE_REQUEST_ID = 495622033

CHANGES = [
    ConversionActionChange(
        conversion_action_id=ESTIMATE_REQUEST_ID,
        always_use_default_value=False,
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()
    ids = [c.conversion_action_id for c in CHANGES]

    print(f"[1/3] Reading state for {ids} on {args.customer_id}...")
    before = fetch_state(client, args.customer_id, ids)
    for s in before:
        print(
            f"  id={s.id} name={s.name!r} default_value={s.default_value} "
            f"always_use_default_value={s.always_use_default_value}"
        )

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        print(
            f"  id={c.conversion_action_id}: "
            f"always_use_default_value -> {c.always_use_default_value}"
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
            f"  id={s.id} default_value={s.default_value} "
            f"always_use_default_value={s.always_use_default_value}"
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
