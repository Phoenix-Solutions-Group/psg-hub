"""Phase 1.1b — Demote unused customer-level conversion goals.

Closes the gap left by Phase 1.1: the original cleanup tried to flip
include_in_conversions_metric=False on stale ConversionAction records, but
Google rejects those mutates (REMOVED actions, UA Goals, system-managed types
are all immutable at the ConversionAction surface).

The correct surface is CustomerConversionGoal. Each (category, origin) tuple
has a `biddable` flag; setting it to false stops Smart Bidding from
optimizing toward that category, regardless of whether any underlying
ConversionAction is mutable.

State analysis (2026-05-12):
  DOWNLOAD~APP biddable=TRUE     <- backed only by 'Android installs (all other apps)',
                                    a system-managed action Tedesco doesn't actually use
                                    (no Android app). Demote.
  PHONE_CALL_LEAD~CALL_FROM_ADS  <- keep biddable=true; backed by 'Calls from Smart
                                    Campaign Ads' (ENABLED).
  BOOK_APPOINTMENT~WEBSITE       <- keep; backed by 'Start Estimate Request' (ENABLED).
  CONTACT~WEBSITE                <- keep; backed by 'Contact Us' GA4 (ENABLED).
  CONTACT~CALL_FROM_ADS          <- keep; backed by 'Smart campaign ad clicks to call'.
  CONTACT~GOOGLE_HOSTED          <- already biddable=false.
  GET_DIRECTIONS~GOOGLE_HOSTED   <- already biddable=false.
  STORE_VISIT~STORE              <- already biddable=false.

Fix: flip DOWNLOAD~APP biddable to FALSE. Reversible.

Usage:
    python -m ops.tedesco.demote_unused_goals --customer-id 7763526490
    python -m ops.tedesco.demote_unused_goals --customer-id 7763526490 --execute
"""
from __future__ import annotations

import argparse
import sys

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.customer_conversion_goals import (
    CustomerConversionGoalChange,
    apply_changes,
    changes_to_dicts,
    fetch_state,
    state_to_dicts,
)

OP_NAME = "tedesco-demote-unused-goals"

CHANGES = [
    CustomerConversionGoalChange(
        category="DOWNLOAD",
        origin="APP",
        biddable=False,
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true", help="Apply changes")
    args = parser.parse_args()

    client = load_client()

    print(f"[1/3] Reading all CustomerConversionGoal entries on {args.customer_id}...")
    before = fetch_state(client, args.customer_id)
    for s in before:
        marker = "  >>" if (s.category, s.origin) in {(c.category, c.origin) for c in CHANGES} else "    "
        print(f"{marker} {s.category}~{s.origin}: biddable={s.biddable}")

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        print(f"  {c.category}~{c.origin}: biddable -> {c.biddable}")

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
        print(
            f"  updated {r['category']}~{r['origin']} "
            f"({r['resource_name']}) fields={r['updated_fields']}"
        )

    after = fetch_state(client, args.customer_id)
    print("\nPost-mutation state:")
    for s in after:
        marker = "  >>" if (s.category, s.origin) in {(c.category, c.origin) for c in CHANGES} else "    "
        print(f"{marker} {s.category}~{s.origin}: biddable={s.biddable}")

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
