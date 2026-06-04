"""Campaign-level DEVICE bid modifier mutations.

Updates the `bid_modifier` field on existing DEVICE campaign_criterion records.
Google Ads auto-creates DESKTOP / MOBILE / TABLET criteria for every campaign
(resource_names like '{campaign_id}~30000' for DESKTOP, ~30001 MOBILE, ~30002
TABLET) — so this lib does UPDATES, not CREATES.

bid_modifier convention:
  1.0   = no adjustment (default)
  0.75  = -25%
  1.25  = +25%
  0.1   = -90% (floor)
  10.0  = +900% (ceiling)
  ## A bid_modifier of 0 in the API means 'unset' (treated as 1.0). ##

Note on Smart Bidding strategies:
  Google ignores standard device bid modifiers under MAX_CONV (no tCPA),
  MAX_CONVERSION_VALUE (no tROAS), and portfolio strategies. Only -100%
  (exclusion via separate mechanism) works in those cases. Modifiers
  re-activate once the campaign layers in tCPA/tROAS.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


VALID_DEVICES = {"DESKTOP", "MOBILE", "TABLET"}

# Pattern: Google Ads always assigns these criterion IDs per campaign.
_DEVICE_CRIT_ID = {
    "DESKTOP": 30000,
    "MOBILE": 30001,
    "TABLET": 30002,
}


@dataclass
class DeviceBidModState:
    campaign_id: int
    campaign_name: str
    device: str
    bid_modifier: float
    resource_name: str


@dataclass
class DeviceBidModChange:
    """Set bid_modifier on a specific (campaign, device) tuple."""
    campaign_id: int
    device: str
    bid_modifier: float

    def __post_init__(self) -> None:
        if self.device not in VALID_DEVICES:
            raise ValueError(
                f"device={self.device!r} not in {sorted(VALID_DEVICES)}"
            )
        if not (0.1 <= self.bid_modifier <= 10.0):
            raise ValueError(
                f"bid_modifier={self.bid_modifier} outside Google's [0.1, 10.0] range"
            )


def fetch_state(
    client: GoogleAdsClient, customer_id: str, campaign_ids: list[int]
) -> list[DeviceBidModState]:
    """Read current DEVICE criteria for the given campaigns."""
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in campaign_ids)
    query = f"""
        SELECT
          campaign.id,
          campaign.name,
          campaign_criterion.resource_name,
          campaign_criterion.device.type,
          campaign_criterion.bid_modifier
        FROM campaign_criterion
        WHERE campaign.id IN ({ids_sql})
          AND campaign_criterion.type = 'DEVICE'
    """
    out: list[DeviceBidModState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        out.append(
            DeviceBidModState(
                campaign_id=row.campaign.id,
                campaign_name=row.campaign.name,
                device=row.campaign_criterion.device.type.name,
                bid_modifier=float(row.campaign_criterion.bid_modifier),
                resource_name=row.campaign_criterion.resource_name,
            )
        )
    return out


def apply_changes(
    client: GoogleAdsClient,
    customer_id: str,
    changes: list[DeviceBidModChange],
) -> list[dict[str, Any]]:
    """Update bid_modifier on existing DEVICE criteria."""
    cc_service = client.get_service("CampaignCriterionService")

    operations = []
    update_masks_for_log: list[list[str]] = []

    for change in changes:
        op = client.get_type("CampaignCriterionOperation")
        crit = op.update
        crit_id = _DEVICE_CRIT_ID[change.device]
        crit.resource_name = (
            f"customers/{customer_id}/campaignCriteria/"
            f"{change.campaign_id}~{crit_id}"
        )
        crit.bid_modifier = change.bid_modifier

        op.update_mask.paths.append("bid_modifier")
        operations.append(op)
        update_masks_for_log.append(["bid_modifier"])

    response = cc_service.mutate_campaign_criteria(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "campaign_id": changes[i].campaign_id,
            "device": changes[i].device,
            "bid_modifier": changes[i].bid_modifier,
            "resource_name": r.resource_name,
            "updated_fields": mask,
        }
        for i, (r, mask) in enumerate(zip(response.results, update_masks_for_log))
    ]


def state_to_dicts(states: list[DeviceBidModState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]


def changes_to_dicts(changes: list[DeviceBidModChange]) -> list[dict[str, Any]]:
    return [asdict(c) for c in changes]
