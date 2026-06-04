"""Campaign network_settings mutations.

For lead-gen Search campaigns, you almost always want:
  target_google_search = True
  target_search_network = False   # Google search partners
  target_content_network = False  # Display network
  target_partner_search_network = False

Search partners and display delivery from a Search campaign tend to inflate
clicks at low intent and often track as invalid. Disabling them is reversible.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


@dataclass
class CampaignNetworkState:
    campaign_id: int
    name: str
    status: str
    advertising_channel_type: str
    target_google_search: bool
    target_search_network: bool
    target_content_network: bool
    target_partner_search_network: bool


@dataclass
class CampaignNetworkChange:
    """Patch spec. Only set fields you want to change; None = leave alone."""
    campaign_id: int
    target_google_search: bool | None = None
    target_search_network: bool | None = None
    target_content_network: bool | None = None
    target_partner_search_network: bool | None = None


def fetch_state(
    client: GoogleAdsClient, customer_id: str, campaign_ids: list[int]
) -> list[CampaignNetworkState]:
    """Read network_settings for the given campaigns."""
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in campaign_ids)
    query = f"""
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.network_settings.target_google_search,
          campaign.network_settings.target_search_network,
          campaign.network_settings.target_content_network,
          campaign.network_settings.target_partner_search_network
        FROM campaign
        WHERE campaign.id IN ({ids_sql})
    """
    states: list[CampaignNetworkState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        c = row.campaign
        states.append(
            CampaignNetworkState(
                campaign_id=c.id,
                name=c.name,
                status=c.status.name,
                advertising_channel_type=c.advertising_channel_type.name,
                target_google_search=bool(c.network_settings.target_google_search),
                target_search_network=bool(c.network_settings.target_search_network),
                target_content_network=bool(c.network_settings.target_content_network),
                target_partner_search_network=bool(
                    c.network_settings.target_partner_search_network
                ),
            )
        )
    return states


def apply_changes(
    client: GoogleAdsClient,
    customer_id: str,
    changes: list[CampaignNetworkChange],
) -> list[dict[str, Any]]:
    """Mutate campaign network_settings. Returns API responses per operation."""
    campaign_service = client.get_service("CampaignService")

    operations = []
    update_masks_for_log: list[list[str]] = []

    for change in changes:
        op = client.get_type("CampaignOperation")
        c = op.update
        c.resource_name = campaign_service.campaign_path(
            customer_id, change.campaign_id
        )
        updated_fields: list[str] = []

        if change.target_google_search is not None:
            c.network_settings.target_google_search = change.target_google_search
            updated_fields.append("network_settings.target_google_search")
        if change.target_search_network is not None:
            c.network_settings.target_search_network = change.target_search_network
            updated_fields.append("network_settings.target_search_network")
        if change.target_content_network is not None:
            c.network_settings.target_content_network = change.target_content_network
            updated_fields.append("network_settings.target_content_network")
        if change.target_partner_search_network is not None:
            c.network_settings.target_partner_search_network = (
                change.target_partner_search_network
            )
            updated_fields.append("network_settings.target_partner_search_network")

        # Explicit update_mask paths. protobuf_helpers.field_mask() drops
        # bool=False (proto default), causing silent no-op on the API.
        op.update_mask.paths.extend(updated_fields)
        operations.append(op)
        update_masks_for_log.append(updated_fields)

    response = campaign_service.mutate_campaigns(
        customer_id=customer_id, operations=operations
    )
    return [
        {"resource_name": r.resource_name, "updated_fields": mask}
        for r, mask in zip(response.results, update_masks_for_log)
    ]


def state_to_dicts(states: list[CampaignNetworkState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]


def changes_to_dicts(changes: list[CampaignNetworkChange]) -> list[dict[str, Any]]:
    return [asdict(c) for c in changes]
