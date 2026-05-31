"""Campaign-level negative keyword mutations.

Adds negative KeywordInfo criteria at campaign scope. For cross-campaign reuse,
the Smart Campaign's existing pattern of campaign-level negatives is mirrored
here per-campaign rather than promoting to a SharedSet — keeps API surface
small and matches existing account structure.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


VALID_MATCH_TYPES = {"EXACT", "PHRASE", "BROAD"}


@dataclass
class NegativeKeyword:
    text: str
    match_type: str  # one of VALID_MATCH_TYPES

    def __post_init__(self) -> None:
        if self.match_type not in VALID_MATCH_TYPES:
            raise ValueError(
                f"match_type={self.match_type!r} not in {sorted(VALID_MATCH_TYPES)}"
            )


@dataclass
class CampaignNegativeState:
    campaign_id: int
    keyword_text: str
    match_type: str
    resource_name: str


def fetch_existing_negatives(
    client: GoogleAdsClient, customer_id: str, campaign_ids: list[int]
) -> list[CampaignNegativeState]:
    """Read current campaign-level negative keywords for given campaigns."""
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in campaign_ids)
    query = f"""
        SELECT
          campaign.id,
          campaign_criterion.resource_name,
          campaign_criterion.keyword.text,
          campaign_criterion.keyword.match_type
        FROM campaign_criterion
        WHERE campaign.id IN ({ids_sql})
          AND campaign_criterion.negative = true
          AND campaign_criterion.type = 'KEYWORD'
    """
    out: list[CampaignNegativeState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        out.append(
            CampaignNegativeState(
                campaign_id=row.campaign.id,
                keyword_text=row.campaign_criterion.keyword.text,
                match_type=row.campaign_criterion.keyword.match_type.name,
                resource_name=row.campaign_criterion.resource_name,
            )
        )
    return out


def add_campaign_negatives(
    client: GoogleAdsClient,
    customer_id: str,
    campaign_id: int,
    negatives: list[NegativeKeyword],
) -> list[dict[str, Any]]:
    """Add campaign-level negative keywords to a single campaign."""
    cc_service = client.get_service("CampaignCriterionService")
    campaign_service = client.get_service("CampaignService")
    match_type_enum = client.enums.KeywordMatchTypeEnum
    campaign_resource = campaign_service.campaign_path(customer_id, campaign_id)

    operations = []
    for neg in negatives:
        op = client.get_type("CampaignCriterionOperation")
        crit = op.create
        crit.campaign = campaign_resource
        crit.negative = True
        crit.keyword.text = neg.text
        crit.keyword.match_type = getattr(match_type_enum, neg.match_type)
        operations.append(op)

    response = cc_service.mutate_campaign_criteria(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "campaign_id": campaign_id,
            "resource_name": r.resource_name,
            "keyword": negatives[i].text,
            "match_type": negatives[i].match_type,
        }
        for i, r in enumerate(response.results)
    ]


def state_to_dicts(states: list[CampaignNegativeState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]


def negatives_to_dicts(negs: list[NegativeKeyword]) -> list[dict[str, Any]]:
    return [asdict(n) for n in negs]
