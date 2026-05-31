"""
Wallace Collision Center — enable brand campaign GOOG_WAL_SRCH_Brand_2026Q2.

Current state (2026-05-18):
  Campaign 23825006324  status=PAUSED  bidding=TARGET_IMPRESSION_SHARE  budget=$7/d
  Budget   15555808511  $7,000,000 micros = $7/d
  Ad group 203049696184 "Brand Terms"  (no keywords yet — populates here)

Changes:
  1. Switch bidding to TARGET_SPEND (= Maximize Clicks) with $1.50 CPC ceiling.
  2. Raise daily budget $7 → $15 (15_000_000 micros).
  3. Add EXACT brand keywords on the Brand Terms ad group:
       [wallace collision]
       [wallace collision center]
       [wallace collision center bristol]
       [wallace collision bristol tn]
       [wallace collision kingsport]
  4. Set campaign status → ENABLED.

Run: python -m ops.wallace.enable_brand_campaign --dry-run
Run: python -m ops.wallace.enable_brand_campaign --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.protobuf import field_mask_pb2

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client

CUSTOMER_ID = "6048611995"

CAMPAIGN_ID = 23825006324
BUDGET_ID = 15555808511
AD_GROUP_ID = 203049696184

NEW_BUDGET_MICROS = 15_000_000        # $15.00 / day
NEW_CPC_CEILING_MICROS = 1_500_000    # $1.50

BRAND_KEYWORDS_EXACT: list[str] = [
    "wallace collision",
    "wallace collision center",
    "wallace collision center bristol",
    "wallace collision bristol tn",
    "wallace collision kingsport",
]


def fetch_state(client) -> dict:
    ga = client.get_service("GoogleAdsService")

    campaign_q = f"""
        SELECT campaign.id, campaign.name, campaign.status,
               campaign.bidding_strategy_type, campaign.campaign_budget,
               campaign.target_impression_share.location,
               campaign.target_impression_share.location_fraction_micros
        FROM campaign
        WHERE campaign.id = {CAMPAIGN_ID}
    """
    campaign = None
    for row in ga.search(customer_id=CUSTOMER_ID, query=campaign_q):
        c = row.campaign
        campaign = {
            "id": c.id,
            "name": c.name,
            "status": c.status.name,
            "bidding_strategy_type": c.bidding_strategy_type.name,
            "budget_resource": c.campaign_budget,
        }

    budget_q = f"""
        SELECT campaign_budget.id, campaign_budget.name,
               campaign_budget.amount_micros, campaign_budget.status
        FROM campaign_budget
        WHERE campaign_budget.id = {BUDGET_ID}
    """
    budget = None
    for row in ga.search(customer_id=CUSTOMER_ID, query=budget_q):
        b = row.campaign_budget
        budget = {
            "id": b.id,
            "name": b.name,
            "amount_micros": b.amount_micros,
            "status": b.status.name,
        }

    kw_q = f"""
        SELECT ad_group_criterion.criterion_id,
               ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type,
               ad_group_criterion.status
        FROM ad_group_criterion
        WHERE ad_group.id = {AD_GROUP_ID}
          AND ad_group_criterion.type = 'KEYWORD'
    """
    keywords = []
    for row in ga.search(customer_id=CUSTOMER_ID, query=kw_q):
        c = row.ad_group_criterion
        keywords.append({
            "criterion_id": c.criterion_id,
            "text": c.keyword.text,
            "match_type": c.keyword.match_type.name,
            "status": c.status.name,
        })

    return {"campaign": campaign, "budget": budget, "existing_keywords": keywords}


def apply_changes(client, before: dict) -> dict:
    """Sequence:
       1) raise budget
       2) switch bidding to TARGET_SPEND with CPC ceiling
       3) add keywords
       4) enable campaign
    """
    out: dict = {}

    # 1. Budget
    bs = client.get_service("CampaignBudgetService")
    bop = client.get_type("CampaignBudgetOperation")
    bop.update.resource_name = bs.campaign_budget_path(CUSTOMER_ID, BUDGET_ID)
    bop.update.amount_micros = NEW_BUDGET_MICROS
    bop.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["amount_micros"]))
    bres = bs.mutate_campaign_budgets(customer_id=CUSTOMER_ID, operations=[bop])
    out["budget"] = {"resource_name": bres.results[0].resource_name}

    # 2. Bidding strategy switch + cpc ceiling (single update)
    cs = client.get_service("CampaignService")
    cop = client.get_type("CampaignOperation")
    cop.update.resource_name = cs.campaign_path(CUSTOMER_ID, CAMPAIGN_ID)
    cop.update.target_spend.cpc_bid_ceiling_micros = NEW_CPC_CEILING_MICROS
    cop.update_mask.CopyFrom(
        field_mask_pb2.FieldMask(paths=["target_spend.cpc_bid_ceiling_micros"])
    )
    cres = cs.mutate_campaigns(customer_id=CUSTOMER_ID, operations=[cop])
    out["bidding"] = {"resource_name": cres.results[0].resource_name}

    # 3. Keywords (skip existing matches)
    existing_keys = {
        (k["text"].lower(), k["match_type"]) for k in before["existing_keywords"]
    }
    kws_to_add = [
        t for t in BRAND_KEYWORDS_EXACT
        if (t.lower(), "EXACT") not in existing_keys
    ]
    if kws_to_add:
        agcs = client.get_service("AdGroupCriterionService")
        ag_svc = client.get_service("AdGroupService")
        ag_resource = ag_svc.ad_group_path(CUSTOMER_ID, AD_GROUP_ID)
        kops = []
        for t in kws_to_add:
            kop = client.get_type("AdGroupCriterionOperation")
            crit = kop.create
            crit.ad_group = ag_resource
            crit.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            crit.keyword.text = t
            crit.keyword.match_type = client.enums.KeywordMatchTypeEnum.EXACT
            kops.append(kop)
        kres = agcs.mutate_ad_group_criteria(
            customer_id=CUSTOMER_ID, operations=kops
        )
        out["keywords"] = [
            {"resource_name": r.resource_name, "text": kws_to_add[i]}
            for i, r in enumerate(kres.results)
        ]
    else:
        out["keywords"] = []

    # 4. Enable campaign
    eop = client.get_type("CampaignOperation")
    eop.update.resource_name = cs.campaign_path(CUSTOMER_ID, CAMPAIGN_ID)
    eop.update.status = client.enums.CampaignStatusEnum.ENABLED
    eop.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["status"]))
    eres = cs.mutate_campaigns(customer_id=CUSTOMER_ID, operations=[eop])
    out["enable"] = {"resource_name": eres.results[0].resource_name}

    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = not args.execute

    client = load_client()

    print("\n=== Wallace Brand Campaign Enable ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")

    before = fetch_state(client)
    print("\n--- Before ---")
    print(f"  Campaign: {before['campaign']}")
    print(f"  Budget:   {before['budget']}")
    print(f"  Existing keywords in ad group {AD_GROUP_ID}: {len(before['existing_keywords'])}")
    for k in before["existing_keywords"]:
        print(f"    {k}")

    planned = {
        "budget_amount_micros": NEW_BUDGET_MICROS,
        "bidding_strategy": "TARGET_SPEND",
        "cpc_bid_ceiling_micros": NEW_CPC_CEILING_MICROS,
        "keywords_to_add": [
            {"text": t, "match_type": "EXACT"}
            for t in BRAND_KEYWORDS_EXACT
            if (t.lower(), "EXACT") not in {
                (k["text"].lower(), k["match_type"]) for k in before["existing_keywords"]
            }
        ],
        "set_status": "ENABLED",
    }
    print("\n--- Planned changes ---")
    print(f"  Budget: ${before['budget']['amount_micros']/1_000_000:.2f}/d "
          f"→ ${NEW_BUDGET_MICROS/1_000_000:.2f}/d")
    print(f"  Bidding: {before['campaign']['bidding_strategy_type']} "
          f"→ TARGET_SPEND (CPC ceiling ${NEW_CPC_CEILING_MICROS/1_000_000:.2f})")
    print(f"  Keywords to add (EXACT): {len(planned['keywords_to_add'])}")
    for k in planned["keywords_to_add"]:
        print(f"    [{k['text']}]")
    print(f"  Status: {before['campaign']['status']} → ENABLED")

    if dry_run:
        write_audit(
            op_name="wallace-enable-brand-campaign",
            customer_id=CUSTOMER_ID,
            before=before,
            changes=planned,
            after=None,
            dry_run=True,
        )
        print("\n[DRY RUN] No changes applied. Re-run with --execute to commit.")
        return

    print("\n=== Applying changes ===")
    results = apply_changes(client, before)
    for k, v in results.items():
        print(f"  [OK] {k}: {v}")

    after = fetch_state(client)
    write_audit(
        op_name="wallace-enable-brand-campaign",
        customer_id=CUSTOMER_ID,
        before=before,
        changes=planned,
        after=after,
        dry_run=False,
    )

    print("\n--- After ---")
    print(f"  Campaign: {after['campaign']}")
    print(f"  Budget:   {after['budget']}")
    print(f"  Keywords: {len(after['existing_keywords'])}")
    for k in after["existing_keywords"]:
        print(f"    {k}")

    print("\nDone. Monitor brand campaign for 7 days. Expected: 20-40 conv/mo at $3-5 CPA.")


if __name__ == "__main__":
    main()
