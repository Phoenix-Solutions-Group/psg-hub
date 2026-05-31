"""Phase 1.1 — Clean up Tedesco Auto Body conversion action signal.

Background: original audit flagged 10 stale primary actions. Empirical
testing revealed Google enforces immutability on:
  - REMOVED actions (error: "field attempted to be mutated is immutable")
  - UNIVERSAL_ANALYTICS_GOAL actions (error: MUTATE_NOT_ALLOWED — UA sunset)

REMOVED + UA-sunset actions cannot fire new events anyway, so their stale
`include_in_conversions_metric=True` flag is residual state, not live bidding
pollution. They are listed for visibility only.

Actually mutable + irrelevant ENABLED action:
  954599465  Android installs (all other apps)  ENABLED primary=True include=True
    — Collision shop has no app; this slot drags Smart Bidding signal.

This script demotes the one mutable irrelevant ENABLED action. Reversible.
Does NOT touch primary_for_goal (requires CustomerConversionGoal mutations
in a separate op).

Active actions left counting after this script:
  495622033  Start Estimate Request          (ENABLED)
  6705005193 Contact Us                      (ENABLED)
  6830494456 Calls from Smart Campaign Ads   (ENABLED)
  6830544411 Smart campaign ad clicks to call (ENABLED)

Usage:
    python -m ops.tedesco.cleanup_conversion_actions --customer-id 7763526490
    python -m ops.tedesco.cleanup_conversion_actions --customer-id 7763526490 --execute
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

OP_NAME = "tedesco-cleanup-conversion-actions"

# Mutable ENABLED actions that are irrelevant to collision-repair lead gen.
# These DO affect live bidding signal and CAN be mutated.
ENABLED_IRRELEVANT: list[tuple[int, str, str]] = [
    (954599465, "Android installs (all other apps)", "Tedesco has no Android app; remove from goal"),
]

# Stale REMOVED + UA Goal actions. Google rejects mutates on these:
#   REMOVED   -> "The field attempted to be mutated is immutable."
#   UA Goals  -> MUTATE_NOT_ALLOWED (UA sunset 2023)
# Listed for visibility only. Inert for live bidding (cannot fire new events).
IMMUTABLE_STALE: list[tuple[int, str, str, str]] = [
    (313909870, "Tesla Body Repair Ads", "REMOVED", "WEBPAGE"),
    (425342847, "Calls from ads", "REMOVED", "AD_CALL"),
    (495907578, "Get Estimate - Body Shop Booster (RAW)", "HIDDEN", "UNIVERSAL_ANALYTICS_GOAL"),
    (495907581, "Get Estimate - Body Shop Booster (Test)", "HIDDEN", "UNIVERSAL_ANALYTICS_GOAL"),
    (495907584, "Start Estimate (MASTER)", "REMOVED", "UNIVERSAL_ANALYTICS_GOAL"),
    (495907587, "Porsche Form Submit (MASTER)", "HIDDEN", "UNIVERSAL_ANALYTICS_GOAL"),
    (495907590, "Tesla Form Submit (MASTER)", "HIDDEN", "UNIVERSAL_ANALYTICS_GOAL"),
    (536506466, "Smart Goal (MASTER)", "HIDDEN", "UNIVERSAL_ANALYTICS_GOAL"),
    (616239798, "CROToolkitLandingPage", "REMOVED", "WEBPAGE"),
    (616269799, "CROToolkitPopup", "REMOVED", "WEBPAGE"),
]

CHANGES = [
    ConversionActionChange(
        conversion_action_id=ca_id,
        include_in_conversions_metric=False,
    )
    for ca_id, _, _ in ENABLED_IRRELEVANT
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

    print(
        f"[1/3] Reading state for {len(ids)} mutable ENABLED-irrelevant actions on "
        f"{args.customer_id}..."
    )
    before = fetch_state(client, args.customer_id, ids)
    reason_by_id = {ca_id: reason for ca_id, _, reason in ENABLED_IRRELEVANT}
    for s in before:
        print(
            f"  id={s.id} status={s.status} type={s.type} primary={s.primary_for_goal} "
            f"include_in_metric={s.include_in_conversions_metric} "
            f"name={s.name!r} ({reason_by_id.get(s.id, '')})"
        )

    print(
        f"\n  IMMUTABLE STALE (visible in UI, inert for live bidding — "
        f"{len(IMMUTABLE_STALE)} actions):"
    )
    for ca_id, name, status, ca_type in IMMUTABLE_STALE:
        print(f"    id={ca_id} type={ca_type} status={status} name={name!r}")

    print("\n[2/3] Planned changes:")
    for c in CHANGES:
        print(f"  id={c.conversion_action_id}: include_in_conversions_metric -> False")

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
        print(f"  OK id={r['conversion_action_id']} fields={r['updated_fields']}")

    after = fetch_state(client, args.customer_id, ids)
    print("\nPost-mutation state:")
    for s in after:
        print(
            f"  id={s.id} include_in_metric={s.include_in_conversions_metric} "
            f"name={s.name!r}"
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
