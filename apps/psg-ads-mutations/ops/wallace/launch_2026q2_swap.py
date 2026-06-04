"""Wallace Collision Center — Q2 2026 campaign swap.

Account: 604-861-1995 (customer_id: 6048611995)

Pauses 3 legacy enabled campaigns and enables their 3 replacement campaigns,
matching the legacy daily budgets so monthly spend stays flat ($125/day total
including Ford Brand and Toyota_2026Q2, which are left untouched).

Pause:
  - 12414861277  PPC_Wallace_40Miles            ($43/day)  -> replaced by LocalCollision_2026Q2
  - 19730091513  Tesla Approved                 ($30/day)  -> replaced by TeslaApproved_2026Q2
  - 21269931336  JLR Certified Collision Repairs ($30/day) -> replaced by JLRCertified_2026Q2

Enable + budget bump:
  - 23829477511  LocalCollision_2026Q2  budget 15560431644  $40 -> $43
  - 23825006339  TeslaApproved_2026Q2   budget 15565643947  $5  -> $30
  - 23819664216  JLRCertified_2026Q2    budget 15560441190  $3  -> $30

Left untouched:
  - 22896707513  Wallace Ford of Kingsport Brand (SMART, $9/day) -- per client
  - 23819659089  GOOG_WAL_SRCH_ToyotaCertified_2026Q2 (already enabled, $13/day)
  - 23825006324  GOOG_WAL_SRCH_Brand_2026Q2 (remains paused)

Run: python -m ops.wallace.launch_2026q2_swap --dry-run
     python -m ops.wallace.launch_2026q2_swap --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client

CUSTOMER_ID = "6048611995"

PAUSE_CAMPAIGN_IDS = [
    12414861277,  # PPC_Wallace_40Miles
    19730091513,  # Tesla Approved
    21269931336,  # JLR Certified Collision Repairs
]

ENABLE_CAMPAIGN_IDS = [
    23829477511,  # GOOG_WAL_SRCH_LocalCollision_2026Q2
    23825006339,  # GOOG_WAL_SRCH_TeslaApproved_2026Q2
    23819664216,  # GOOG_WAL_SRCH_JLRCertified_2026Q2
]

# campaign_budget_id -> new daily amount in dollars
BUDGET_UPDATES = {
    15560431644: 43,  # LocalCollision_2026Q2  $40 -> $43
    15565643947: 30,  # TeslaApproved_2026Q2   $5  -> $30
    15560441190: 30,  # JLRCertified_2026Q2    $3  -> $30
}

ALL_CAMPAIGN_IDS = PAUSE_CAMPAIGN_IDS + ENABLE_CAMPAIGN_IDS


def fetch_campaign_state(client, customer_id: str, campaign_ids: list[int]) -> list[dict]:
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in campaign_ids)
    query = f"""
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign_budget.id,
          campaign_budget.amount_micros
        FROM campaign
        WHERE campaign.id IN ({ids_sql})
    """
    rows = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        rows.append({
            "campaign_id": row.campaign.id,
            "name": row.campaign.name,
            "status": row.campaign.status.name,
            "budget_id": row.campaign_budget.id,
            "budget_micros": row.campaign_budget.amount_micros,
        })
    return rows


def set_campaign_status(client, customer_id: str, campaign_id: int, status_enum_name: str):
    campaign_service = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    campaign = op.update
    campaign.resource_name = campaign_service.campaign_path(customer_id, campaign_id)
    campaign.status = getattr(client.enums.CampaignStatusEnum, status_enum_name)
    op.update_mask.paths.append("status")
    return campaign_service.mutate_campaigns(
        customer_id=customer_id, operations=[op]
    )


def set_budget_amount(client, customer_id: str, budget_id: int, dollars: int):
    budget_service = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    budget = op.update
    budget.resource_name = budget_service.campaign_budget_path(customer_id, budget_id)
    budget.amount_micros = dollars * 1_000_000
    op.update_mask.paths.append("amount_micros")
    return budget_service.mutate_campaign_budgets(
        customer_id=customer_id, operations=[op]
    )


def print_state(label: str, rows: list[dict]) -> None:
    print(f"\n=== {label} ===")
    for r in rows:
        dollars = r["budget_micros"] / 1_000_000
        print(f"  [{r['campaign_id']}] {r['name']:<50}  "
              f"status={r['status']:<8}  budget=${dollars:.2f}/day")


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = args.dry_run

    client = load_client()

    before = fetch_campaign_state(client, CUSTOMER_ID, ALL_CAMPAIGN_IDS)
    print_state("BEFORE", before)

    changes = {
        "pause_campaigns": PAUSE_CAMPAIGN_IDS,
        "enable_campaigns": ENABLE_CAMPAIGN_IDS,
        "budget_updates": {str(k): v for k, v in BUDGET_UPDATES.items()},
    }

    print("\n=== Planned Changes ===")
    print(f"  Pause:  {PAUSE_CAMPAIGN_IDS}")
    print(f"  Enable: {ENABLE_CAMPAIGN_IDS}")
    print(f"  Budgets (campaign_budget_id -> $/day):")
    for bid, dollars in BUDGET_UPDATES.items():
        print(f"    {bid}: ${dollars}/day")

    if dry_run:
        print("\nDRY RUN -- no API mutations executed. Re-run with --execute to apply.")
        path = write_audit(
            op_name="wallace-launch-2026q2-swap",
            customer_id=CUSTOMER_ID,
            before=before,
            changes=changes,
            after=None,
            dry_run=True,
        )
        print(f"\nAudit log: {path}")
        return

    print("\n=== Applying ===")

    # Step 1: bump budgets on new campaigns BEFORE enabling. This avoids any
    # window where a new campaign is enabled at its old (too-low) budget.
    for budget_id, dollars in BUDGET_UPDATES.items():
        resp = set_budget_amount(client, CUSTOMER_ID, budget_id, dollars)
        print(f"  [OK] budget {budget_id} -> ${dollars}/day "
              f"({resp.results[0].resource_name})")

    # Step 2: pause legacy campaigns
    for cid in PAUSE_CAMPAIGN_IDS:
        resp = set_campaign_status(client, CUSTOMER_ID, cid, "PAUSED")
        print(f"  [OK] paused {cid} ({resp.results[0].resource_name})")

    # Step 3: enable replacement campaigns
    for cid in ENABLE_CAMPAIGN_IDS:
        resp = set_campaign_status(client, CUSTOMER_ID, cid, "ENABLED")
        print(f"  [OK] enabled {cid} ({resp.results[0].resource_name})")

    after = fetch_campaign_state(client, CUSTOMER_ID, ALL_CAMPAIGN_IDS)
    print_state("AFTER", after)

    path = write_audit(
        op_name="wallace-launch-2026q2-swap",
        customer_id=CUSTOMER_ID,
        before=before,
        changes=changes,
        after=after,
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    print("\nDone. Monitor delivery + conversions for 48h.")


if __name__ == "__main__":
    main()
