"""Campaign LOCATION criteria mutations.

Adds positive LOCATION campaign criteria using geo_target_constant resource
names. Does not handle PROXIMITY (radius) targeting in v1 — collision shops
target city/county/borough constants which are stable and shareable.

Listing geo_target_constants requires a separate API call to resolve human
names (canonical_name field) — exposed via fetch_geo_names().
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


@dataclass
class CampaignLocationState:
    campaign_id: int
    geo_target_constant: str  # resource name like 'geoTargetConstants/1023496'
    geo_target_id: int
    resource_name: str  # campaign_criterion resource name


@dataclass
class GeoTargetName:
    geo_target_id: int
    name: str
    canonical_name: str
    target_type: str
    country_code: str


def fetch_campaign_locations(
    client: GoogleAdsClient, customer_id: str, campaign_ids: list[int]
) -> list[CampaignLocationState]:
    """Read current LOCATION criteria for the given campaigns."""
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in campaign_ids)
    query = f"""
        SELECT
          campaign.id,
          campaign_criterion.resource_name,
          campaign_criterion.location.geo_target_constant
        FROM campaign_criterion
        WHERE campaign.id IN ({ids_sql})
          AND campaign_criterion.type = 'LOCATION'
          AND campaign_criterion.negative = false
    """
    out: list[CampaignLocationState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        gtc = row.campaign_criterion.location.geo_target_constant
        gtc_id = int(gtc.split("/")[-1]) if gtc else 0
        out.append(
            CampaignLocationState(
                campaign_id=row.campaign.id,
                geo_target_constant=gtc,
                geo_target_id=gtc_id,
                resource_name=row.campaign_criterion.resource_name,
            )
        )
    return out


def fetch_geo_names(
    client: GoogleAdsClient, customer_id: str, geo_target_ids: list[int]
) -> dict[int, GeoTargetName]:
    """Resolve geo_target_constant IDs to human names."""
    if not geo_target_ids:
        return {}
    ga_service = client.get_service("GoogleAdsService")
    resource_names = ", ".join(
        f"'geoTargetConstants/{gid}'" for gid in geo_target_ids
    )
    query = f"""
        SELECT
          geo_target_constant.id,
          geo_target_constant.name,
          geo_target_constant.canonical_name,
          geo_target_constant.target_type,
          geo_target_constant.country_code
        FROM geo_target_constant
        WHERE geo_target_constant.resource_name IN ({resource_names})
    """
    out: dict[int, GeoTargetName] = {}
    for row in ga_service.search(customer_id=customer_id, query=query):
        g = row.geo_target_constant
        out[int(g.id)] = GeoTargetName(
            geo_target_id=int(g.id),
            name=g.name,
            canonical_name=g.canonical_name,
            target_type=g.target_type,
            country_code=g.country_code,
        )
    return out


def add_campaign_locations(
    client: GoogleAdsClient,
    customer_id: str,
    campaign_id: int,
    geo_target_ids: list[int],
) -> list[dict[str, Any]]:
    """Add positive LOCATION criteria to a campaign."""
    cc_service = client.get_service("CampaignCriterionService")
    campaign_service = client.get_service("CampaignService")
    gtc_service = client.get_service("GeoTargetConstantService")
    campaign_resource = campaign_service.campaign_path(customer_id, campaign_id)

    operations = []
    for gid in geo_target_ids:
        op = client.get_type("CampaignCriterionOperation")
        crit = op.create
        crit.campaign = campaign_resource
        crit.negative = False
        crit.location.geo_target_constant = gtc_service.geo_target_constant_path(gid)
        operations.append(op)

    response = cc_service.mutate_campaign_criteria(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "campaign_id": campaign_id,
            "geo_target_id": geo_target_ids[i],
            "resource_name": r.resource_name,
        }
        for i, r in enumerate(response.results)
    ]


def state_to_dicts(states: list[CampaignLocationState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]
