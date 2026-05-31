"""Campaign bidding strategy mutations.

Bidding strategy is a oneof field on Campaign. Setting one of the strategy
messages (target_cpa, maximize_conversions, target_spend, etc.) implicitly
switches the strategy — the previously-set strategy clears automatically.

The update_mask must include the oneof field name of the new strategy, e.g.,
'maximize_conversions'. Do not rely on protobuf_helpers.field_mask() — bool=False
default-value drops cause silent no-ops (see Phase 1 lib bug).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


SUPPORTED_STRATEGIES = {
    "MAXIMIZE_CONVERSIONS",
    "MAXIMIZE_CONVERSION_VALUE",
    "TARGET_CPA",
    "TARGET_ROAS",
    "TARGET_SPEND",
    "MANUAL_CPC",
}


@dataclass
class CampaignBiddingState:
    campaign_id: int
    name: str
    status: str
    bidding_strategy_type: str
    target_cpa_micros: int
    maximize_conversions_target_cpa_micros: int
    target_roas_target_roas: float


@dataclass
class CampaignBiddingChange:
    """Switch campaign to a new bidding strategy.

    For MAXIMIZE_CONVERSIONS without tCPA, set strategy=MAXIMIZE_CONVERSIONS
    and target_cpa_micros=0 (default). For tCPA, supply target_cpa_micros.
    """
    campaign_id: int
    strategy: str  # one of SUPPORTED_STRATEGIES
    target_cpa_micros: int | None = None  # for TARGET_CPA or MAXIMIZE_CONVERSIONS-with-cap
    target_roas: float | None = None  # for TARGET_ROAS or MAXIMIZE_CONVERSION_VALUE-with-target

    def __post_init__(self) -> None:
        if self.strategy not in SUPPORTED_STRATEGIES:
            raise ValueError(
                f"strategy={self.strategy!r} not in {sorted(SUPPORTED_STRATEGIES)}"
            )


# Map strategy name -> Campaign oneof field name
_STRATEGY_FIELD = {
    "MAXIMIZE_CONVERSIONS": "maximize_conversions",
    "MAXIMIZE_CONVERSION_VALUE": "maximize_conversion_value",
    "TARGET_CPA": "target_cpa",
    "TARGET_ROAS": "target_roas",
    "TARGET_SPEND": "target_spend",
    "MANUAL_CPC": "manual_cpc",
}


def fetch_state(
    client: GoogleAdsClient, customer_id: str, campaign_ids: list[int]
) -> list[CampaignBiddingState]:
    """Read current bidding strategy + relevant settings."""
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in campaign_ids)
    query = f"""
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.bidding_strategy_type,
          campaign.target_cpa.target_cpa_micros,
          campaign.maximize_conversions.target_cpa_micros,
          campaign.target_roas.target_roas
        FROM campaign
        WHERE campaign.id IN ({ids_sql})
    """
    states: list[CampaignBiddingState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        c = row.campaign
        states.append(
            CampaignBiddingState(
                campaign_id=c.id,
                name=c.name,
                status=c.status.name,
                bidding_strategy_type=c.bidding_strategy_type.name,
                target_cpa_micros=int(c.target_cpa.target_cpa_micros),
                maximize_conversions_target_cpa_micros=int(
                    c.maximize_conversions.target_cpa_micros
                ),
                target_roas_target_roas=float(c.target_roas.target_roas),
            )
        )
    return states


def apply_changes(
    client: GoogleAdsClient,
    customer_id: str,
    changes: list[CampaignBiddingChange],
) -> list[dict[str, Any]]:
    """Switch campaigns to new bidding strategies."""
    campaign_service = client.get_service("CampaignService")

    operations = []
    update_masks_for_log: list[list[str]] = []

    for change in changes:
        op = client.get_type("CampaignOperation")
        c = op.update
        c.resource_name = campaign_service.campaign_path(
            customer_id, change.campaign_id
        )

        oneof_field = _STRATEGY_FIELD[change.strategy]
        strategy_msg = getattr(c, oneof_field)
        mask_paths: list[str] = []

        # Google Ads API: when a bidding-strategy message has subfields, the
        # update_mask must reference the subfield path(s), not the parent.
        # ('The field mask updated a field with subfields' = parent in mask.)
        if change.strategy == "MAXIMIZE_CONVERSIONS":
            strategy_msg.target_cpa_micros = (
                change.target_cpa_micros if change.target_cpa_micros is not None else 0
            )
            mask_paths.append(f"{oneof_field}.target_cpa_micros")
        elif change.strategy == "TARGET_CPA":
            if change.target_cpa_micros is None:
                raise ValueError("TARGET_CPA requires target_cpa_micros")
            strategy_msg.target_cpa_micros = change.target_cpa_micros
            mask_paths.append(f"{oneof_field}.target_cpa_micros")
        elif change.strategy == "MAXIMIZE_CONVERSION_VALUE":
            if change.target_roas is not None:
                strategy_msg.target_roas = change.target_roas
                mask_paths.append(f"{oneof_field}.target_roas")
            else:
                # No subfields set — parent message presence switches strategy.
                mask_paths.append(oneof_field)
        elif change.strategy == "TARGET_ROAS":
            if change.target_roas is None:
                raise ValueError("TARGET_ROAS requires target_roas")
            strategy_msg.target_roas = change.target_roas
            mask_paths.append(f"{oneof_field}.target_roas")
        elif change.strategy == "TARGET_SPEND":
            # TARGET_SPEND has subfields (target_spend_micros, cpc_bid_ceiling_micros).
            # Without explicit values, mask the parent — API allows empty oneof set.
            mask_paths.append(oneof_field)
        elif change.strategy == "MANUAL_CPC":
            mask_paths.append(oneof_field)

        op.update_mask.paths.extend(mask_paths)
        operations.append(op)
        update_masks_for_log.append(mask_paths)

    response = campaign_service.mutate_campaigns(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "campaign_id": changes[i].campaign_id,
            "resource_name": r.resource_name,
            "updated_fields": mask,
        }
        for i, (r, mask) in enumerate(zip(response.results, update_masks_for_log))
    ]


def state_to_dicts(states: list[CampaignBiddingState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]


def changes_to_dicts(changes: list[CampaignBiddingChange]) -> list[dict[str, Any]]:
    return [asdict(c) for c in changes]
