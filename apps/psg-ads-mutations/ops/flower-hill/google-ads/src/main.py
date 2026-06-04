"""
Flower Hill Auto Body — Google Ads campaign builder.

Usage:
    python src/main.py                    # build all 3 locations
    python src/main.py --location huntington
    python src/main.py --dry-run          # print plan, no API calls

Fill in CUSTOMER_IDS in data.py before running.
Campaigns are created PAUSED. Enable in Google Ads UI after QA.
"""

import argparse
import sys

from client import get_client
from data import (
    CUSTOMER_IDS, LOCATIONS, AD_GROUPS, AD_COPY,
    NEGATIVE_KEYWORDS, SITELINKS, CALLOUTS,
)
from budgets import create_campaign_budget
from campaigns import create_search_campaign, get_campaign_by_name, add_geo_proximity_target, add_negative_keywords_to_campaign
from ad_groups import create_ad_group, get_ad_group_by_name
from keywords import add_keywords_to_ad_group
from ads import create_rsa
from extensions import add_call_asset, add_sitelink_assets, add_callout_assets, add_structured_snippet

import datetime
MONTH = datetime.date.today().strftime("%Y%m")


def _campaign_name(location_code: str, tier: str) -> str:
    tier_map = {
        "general": "General_Search",
        "ev": "EV_Search",
        "exotic": "Exotic_Search",
        "brand": "Brand_Search",
    }
    return f"GOOG_{location_code}_{tier_map[tier]}_{MONTH}"


def build_location(client, location_key: str, dry_run: bool = False) -> None:
    location = LOCATIONS[location_key]
    customer_id = CUSTOMER_IDS[location_key]
    code = location["code"]

    print(f"\n{'='*60}")
    print(f"Building: {location_key.upper()} ({customer_id})")
    print(f"{'='*60}")

    if customer_id == "FILL_IN":
        print("  ERROR: Fill in customer ID in data.py before running.")
        return

    if dry_run:
        print("  [dry-run] Would create 4 campaigns, ad groups, keywords, ads, extensions.")
        return

    tiers = ["general", "ev", "exotic", "brand"]
    campaign_cpc_bids = {
        "general": 3_000_000,   # $3.00
        "ev":      5_000_000,   # $5.00 (higher intent, floor CPC before competition)
        "exotic":  6_000_000,   # $6.00
        "brand":   1_000_000,   # $1.00
    }

    for tier in tiers:
        print(f"\n--- {tier.upper()} CAMPAIGN ---")
        campaign_name = _campaign_name(code, tier)

        # Budget
        budget_name = f"{campaign_name}_Budget"
        budget_rn = create_campaign_budget(
            client, customer_id, budget_name, location["budgets"][tier]
        )

        # Campaign — skip if already exists (idempotent re-run)
        campaign_rn = get_campaign_by_name(client, customer_id, campaign_name)
        is_new = campaign_rn is None
        if is_new:
            campaign_rn = create_search_campaign(
                client, customer_id, campaign_name, budget_rn, status="PAUSED"
            )
            # Geo + negatives + extensions only on new campaigns (avoid limit errors on re-runs)
            add_geo_proximity_target(
                client, customer_id, campaign_rn,
                location["lat"], location["lng"], location["radius_miles"],
            )
            print(f"  [geo] {location['radius_miles']}mi radius from {location_key}")
            add_negative_keywords_to_campaign(
                client, customer_id, campaign_rn, NEGATIVE_KEYWORDS
            )
            add_call_asset(client, customer_id, campaign_rn, location["phone"])
            add_sitelink_assets(client, customer_id, campaign_rn, SITELINKS)
            add_callout_assets(client, customer_id, campaign_rn, CALLOUTS)
            add_structured_snippet(
                client, customer_id, campaign_rn,
                "Services",
                ["Collision Repair", "Dent Repair", "Paint", "Frame Straightening", "Exotic Car Repair"],
            )
        else:
            print(f"  [skip extensions] campaign pre-existing")

        # Ad groups + keywords + RSA
        groups_key = tier
        # Huntington gets extra Huntington-specific ad group in general campaign
        ad_group_defs = list(AD_GROUPS.get(groups_key, []))
        if tier == "general" and location_key == "huntington":
            ad_group_defs = AD_GROUPS["general_huntington"] + ad_group_defs

        copy = AD_COPY[tier]

        for ag_def in ad_group_defs:
            ag_name = f"{campaign_name} | {ag_def['name']}"
            ag_rn = get_ad_group_by_name(client, customer_id, campaign_rn, ag_name)
            if not ag_rn:
                ag_rn = create_ad_group(
                    client, customer_id, campaign_rn, ag_name,
                    cpc_bid_micros=campaign_cpc_bids[tier],
                )
                add_keywords_to_ad_group(client, customer_id, ag_rn, ag_def["keywords"])
            create_rsa(
                client, customer_id, ag_rn,
                headlines=copy["headlines"],
                descriptions=copy["descriptions"],
                final_url=copy["final_url"],
                path1=copy["display_path"][0],
                path2=copy["display_path"][1],
            )

    print(f"\n[DONE] {location_key} — all campaigns created PAUSED. QA in UI before enabling.")


def main():
    parser = argparse.ArgumentParser(description="Flower Hill Google Ads builder")
    parser.add_argument("--location", choices=list(LOCATIONS.keys()), help="Build single location")
    parser.add_argument("--dry-run", action="store_true", help="Plan only, no API calls")
    args = parser.parse_args()

    if not args.dry_run:
        client = get_client()
    else:
        client = None

    targets = [args.location] if args.location else list(LOCATIONS.keys())

    for loc in targets:
        build_location(client, loc, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
