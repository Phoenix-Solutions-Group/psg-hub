"""
Wallace Collision Center — Smart Bidding signal hygiene.

Two layers of cleanup:

1. ConversionAction-level:
   - GA4 qualify_lead (7194760257): counting_type MANY_PER_CLICK → ONE_PER_CLICK
     (removes ~30% inflation from repeated qualify_lead events per click).
   - Smart campaign ad clicks-to-call (7258748379): include_in_conversions_metric → False
     (Smart-campaign signal should not feed Search bidder).

2. CustomerConversionGoal-level (account-default goals registry):
   Demote engagement goal categories that originate from GOOGLE_HOSTED / SMART_CAMPAIGN.
   The biddable=False flag stops Smart Bidding from optimizing toward map-clicks,
   directions, menu views, etc. while preserving the conversion records.

   Targets (category, origin):
     GET_DIRECTIONS / GOOGLE_HOSTED     → biddable=False
     PAGE_VIEW      / GOOGLE_HOSTED     → biddable=False
     ENGAGEMENT     / GOOGLE_HOSTED     → biddable=False
     CONTACT        / GOOGLE_HOSTED     → biddable=False
     STORE_VISIT    / GOOGLE_HOSTED     → biddable=False (Store visits action)

   Kept biddable=True:
     SUBMIT_LEAD_FORM / WEBSITE
     PHONE_CALL_LEAD  / CALL_FROM_ADS
     PHONE_CALL_LEAD  / GOOGLE_HOSTED  (Smart campaign tracked calls — Ford brand)

The Wallace Ford of Kingsport Brand Smart campaign continues to operate on the
PHONE_CALL_LEAD goal, which is preserved.

Run: python -m ops.wallace.clean_smart_bidding_signal --dry-run
Run: python -m ops.wallace.clean_smart_bidding_signal --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.conversion_actions import (
    ConversionActionChange,
    apply_changes as apply_ca_changes,
    changes_to_dicts as ca_changes_to_dicts,
    fetch_state as fetch_ca_state,
    state_to_dicts as ca_state_to_dicts,
)
from googleads_psg.mutations.customer_conversion_goals import (
    CustomerConversionGoalChange,
    apply_changes as apply_ccg_changes,
    changes_to_dicts as ccg_changes_to_dicts,
    fetch_state as fetch_ccg_state,
    state_to_dicts as ccg_state_to_dicts,
)

CUSTOMER_ID = "6048611995"

# ConversionAction-level edits
QUALIFY_LEAD_ID = 7194760257       # GA4 qualify_lead → counting=ONE_PER_CLICK
SMART_AD_CTC_ID = 7258748379       # Smart ad clicks-to-call → drop from metric

# Demote these account-default goals (category, origin tuples)
GOAL_DEMOTIONS: list[tuple[str, str]] = [
    ("GET_DIRECTIONS", "GOOGLE_HOSTED"),
    ("PAGE_VIEW", "GOOGLE_HOSTED"),
    ("ENGAGEMENT", "GOOGLE_HOSTED"),
    ("CONTACT", "GOOGLE_HOSTED"),
    ("STORE_VISIT", "GOOGLE_HOSTED"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually mutate. Without this flag, runs in dry-run mode.",
    )
    args = parser.parse_args()
    dry_run = not args.execute

    client = load_client()

    print(f"\n=== Wallace Smart Bidding Signal Cleanup ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")

    # ---- Layer 1: ConversionAction edits ----
    print("\n--- ConversionAction snapshot (before) ---")
    ca_before = fetch_ca_state(client, CUSTOMER_ID, [QUALIFY_LEAD_ID, SMART_AD_CTC_ID])
    for s in ca_before:
        print(
            f"  [{s.id}] {s.name}\n"
            f"    status={s.status} | counting={s.counting_type} "
            f"| in_metric={s.include_in_conversions_metric} | primary={s.primary_for_goal}"
        )

    # Both target actions reject all ConversionAction mutations as IMMUTABLE_FIELD:
    #   - QUALIFY_LEAD_ID (7194760257) is a GA4-imported action; counting rules
    #     and metric inclusion are owned by GA4, not Google Ads. Fix: in GA4,
    #     set qualify_lead event to "Once per event" or audit upstream firing.
    #   - SMART_AD_CTC_ID (7258748379) is Smart-campaign-managed; both fields
    #     immutable from the Google Ads API. Fix: archive the Smart campaign
    #     or accept the signal.
    # Goal-level (CustomerConversionGoal) demotions remain the only API lever.
    ca_changes: list[ConversionActionChange] = []
    print("\n--- Planned ConversionAction changes ---")
    print(f"  [{QUALIFY_LEAD_ID}] counting_type: SKIP "
          "(GA4-imported action; counting fixed in GA4 admin)")
    print(f"  [{SMART_AD_CTC_ID}] include_in_conversions_metric: SKIP "
          "(Smart-campaign-managed; mutate rejected as immutable)")

    # ---- Layer 2: CustomerConversionGoal demotions ----
    print("\n--- CustomerConversionGoal snapshot (before) ---")
    ccg_before = fetch_ccg_state(client, CUSTOMER_ID)
    demotion_set = {(c, o) for c, o in GOAL_DEMOTIONS}
    relevant_before = [
        g for g in ccg_before
        if (g.category, g.origin) in demotion_set
        or g.biddable  # also show currently-biddable for context
    ]
    for g in relevant_before:
        marker = " ← TARGET" if (g.category, g.origin) in demotion_set else ""
        print(
            f"  {g.category}/{g.origin}: biddable={g.biddable}{marker}"
        )

    # Build only changes that actually flip a value
    ccg_changes: list[CustomerConversionGoalChange] = []
    for cat, orig in GOAL_DEMOTIONS:
        current = next(
            (g for g in ccg_before if g.category == cat and g.origin == orig),
            None,
        )
        if current is None:
            print(f"  [skip] {cat}/{orig} not present on account")
            continue
        if not current.biddable:
            print(f"  [skip] {cat}/{orig} already biddable=False")
            continue
        ccg_changes.append(
            CustomerConversionGoalChange(
                category=cat, origin=orig, biddable=False
            )
        )

    print(f"\n--- Planned CustomerConversionGoal demotions: {len(ccg_changes)} ---")
    for c in ccg_changes:
        print(f"  {c.category}/{c.origin}: biddable → False")

    if dry_run:
        write_audit(
            op_name="wallace-clean-smart-bidding-signal",
            customer_id=CUSTOMER_ID,
            before={
                "conversion_actions": ca_state_to_dicts(ca_before),
                "customer_conversion_goals": ccg_state_to_dicts(ccg_before),
            },
            changes={
                "conversion_actions": ca_changes_to_dicts(ca_changes),
                "customer_conversion_goals": ccg_changes_to_dicts(ccg_changes),
            },
            after=None,
            dry_run=True,
        )
        print("\n[DRY RUN] No changes applied. Re-run with --execute to commit.")
        return

    print("\n=== Applying ConversionAction changes ===")
    if ca_changes:
        ca_results = apply_ca_changes(client, CUSTOMER_ID, ca_changes)
        for r in ca_results:
            print(f"  [OK] {r['resource_name']} → {r['updated_fields']}")
    else:
        print("  Nothing to apply (all target fields immutable).")

    print("\n=== Applying CustomerConversionGoal demotions ===")
    if ccg_changes:
        ccg_results = apply_ccg_changes(client, CUSTOMER_ID, ccg_changes)
        for r in ccg_results:
            print(f"  [OK] {r['resource_name']} → {r['updated_fields']}")
    else:
        print("  Nothing to apply.")

    ca_after = fetch_ca_state(client, CUSTOMER_ID, [QUALIFY_LEAD_ID, SMART_AD_CTC_ID])
    ccg_after = fetch_ccg_state(client, CUSTOMER_ID)
    write_audit(
        op_name="wallace-clean-smart-bidding-signal",
        customer_id=CUSTOMER_ID,
        before={
            "conversion_actions": ca_state_to_dicts(ca_before),
            "customer_conversion_goals": ccg_state_to_dicts(ccg_before),
        },
        changes={
            "conversion_actions": ca_changes_to_dicts(ca_changes),
            "customer_conversion_goals": ccg_changes_to_dicts(ccg_changes),
        },
        after={
            "conversion_actions": ca_state_to_dicts(ca_after),
            "customer_conversion_goals": ccg_state_to_dicts(ccg_after),
        },
        dry_run=False,
    )

    print("\n=== Post-Change Snapshot ===")
    for s in ca_after:
        print(
            f"  [{s.id}] {s.name}: counting={s.counting_type} "
            f"in_metric={s.include_in_conversions_metric}"
        )
    for g in ccg_after:
        if (g.category, g.origin) in demotion_set:
            print(f"  {g.category}/{g.origin}: biddable={g.biddable}")

    print("\nDone. Smart Bidding now optimizes on forms + real phone calls only.")
    print("Allow 24-48h for bidder to re-stabilize on the cleaner signal.")


if __name__ == "__main__":
    main()
