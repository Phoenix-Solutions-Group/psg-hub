"""Asset + asset-link mutations.

Two-step pattern in Google Ads API:
  1. Create an Asset (sitelink/callout/snippet/call/image) → returns asset_id.
  2. Link the Asset to a scope:
       - CustomerAsset (account-level, inherits to all campaigns)
       - CampaignAsset (per-campaign override)
       - AdGroupAsset (ad-group scope)

Account-level (CustomerAsset) is the broadcast surface — adding one asset
there serves it across every campaign that doesn't explicitly disable it.
Per-campaign assets override account-level for the same field_type.

This lib covers: SITELINK, CALLOUT, STRUCTURED_SNIPPET, CALL.
Image / business-logo handled separately (requires upload pipeline).
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


@dataclass
class SitelinkSpec:
    link_text: str  # max 25 chars
    final_url: str
    description1: str = ""  # max 35 chars
    description2: str = ""  # max 35 chars


@dataclass
class CalloutSpec:
    callout_text: str  # max 25 chars


@dataclass
class StructuredSnippetSpec:
    header: str  # must be from Google's allowed list ('Services', 'Brands', etc.)
    values: list[str] = field(default_factory=list)  # 3-10 items, each max 25 chars


@dataclass
class CallSpec:
    phone_number: str  # E.164 or local format
    country_code: str = "US"  # ISO 3166-1 alpha-2


@dataclass
class ImageSpec:
    """In-line image upload. Bytes go directly into the Asset proto."""
    data: bytes
    name: str = ""  # display name in Google Ads UI (optional)
    mime_type: str = "IMAGE_PNG"  # one of IMAGE_PNG, IMAGE_JPEG, IMAGE_GIF


def create_sitelink_assets(
    client: GoogleAdsClient, customer_id: str, specs: list[SitelinkSpec]
) -> list[int]:
    """Create SITELINK Assets. Returns asset IDs in order."""
    asset_service = client.get_service("AssetService")
    operations = []
    for spec in specs:
        op = client.get_type("AssetOperation")
        a = op.create
        a.sitelink_asset.link_text = spec.link_text
        a.sitelink_asset.description1 = spec.description1
        a.sitelink_asset.description2 = spec.description2
        a.final_urls.append(spec.final_url)
        operations.append(op)
    response = asset_service.mutate_assets(
        customer_id=customer_id, operations=operations
    )
    return [int(r.resource_name.split("/")[-1]) for r in response.results]


def create_callout_assets(
    client: GoogleAdsClient, customer_id: str, specs: list[CalloutSpec]
) -> list[int]:
    """Create CALLOUT Assets. Returns asset IDs in order."""
    asset_service = client.get_service("AssetService")
    operations = []
    for spec in specs:
        op = client.get_type("AssetOperation")
        a = op.create
        a.callout_asset.callout_text = spec.callout_text
        operations.append(op)
    response = asset_service.mutate_assets(
        customer_id=customer_id, operations=operations
    )
    return [int(r.resource_name.split("/")[-1]) for r in response.results]


def create_structured_snippet_assets(
    client: GoogleAdsClient, customer_id: str, specs: list[StructuredSnippetSpec]
) -> list[int]:
    """Create STRUCTURED_SNIPPET Assets. Returns asset IDs in order."""
    asset_service = client.get_service("AssetService")
    operations = []
    for spec in specs:
        op = client.get_type("AssetOperation")
        a = op.create
        a.structured_snippet_asset.header = spec.header
        a.structured_snippet_asset.values.extend(spec.values)
        operations.append(op)
    response = asset_service.mutate_assets(
        customer_id=customer_id, operations=operations
    )
    return [int(r.resource_name.split("/")[-1]) for r in response.results]


def create_call_assets(
    client: GoogleAdsClient, customer_id: str, specs: list[CallSpec]
) -> list[int]:
    """Create CALL Assets. Returns asset IDs in order."""
    asset_service = client.get_service("AssetService")
    operations = []
    for spec in specs:
        op = client.get_type("AssetOperation")
        a = op.create
        a.call_asset.phone_number = spec.phone_number
        a.call_asset.country_code = spec.country_code
        operations.append(op)
    response = asset_service.mutate_assets(
        customer_id=customer_id, operations=operations
    )
    return [int(r.resource_name.split("/")[-1]) for r in response.results]


def create_image_assets(
    client: GoogleAdsClient, customer_id: str, specs: list[ImageSpec]
) -> list[int]:
    """Create IMAGE Assets by uploading bytes inline."""
    asset_service = client.get_service("AssetService")
    mime_enum = client.enums.MimeTypeEnum
    asset_type_enum = client.enums.AssetTypeEnum

    operations = []
    for spec in specs:
        op = client.get_type("AssetOperation")
        a = op.create
        a.type_ = asset_type_enum.IMAGE
        if spec.name:
            a.name = spec.name
        a.image_asset.data = spec.data
        a.image_asset.mime_type = getattr(mime_enum, spec.mime_type)
        operations.append(op)
    response = asset_service.mutate_assets(
        customer_id=customer_id, operations=operations
    )
    return [int(r.resource_name.split("/")[-1]) for r in response.results]


def link_assets_to_customer(
    client: GoogleAdsClient,
    customer_id: str,
    asset_ids: list[int],
    field_type: str,  # 'SITELINK' | 'CALLOUT' | 'STRUCTURED_SNIPPET' | 'CALL'
) -> list[dict[str, Any]]:
    """Attach Assets to the customer (account-level)."""
    ca_service = client.get_service("CustomerAssetService")
    asset_service = client.get_service("AssetService")
    field_type_enum = client.enums.AssetFieldTypeEnum

    operations = []
    for aid in asset_ids:
        op = client.get_type("CustomerAssetOperation")
        link = op.create
        link.asset = asset_service.asset_path(customer_id, aid)
        link.field_type = getattr(field_type_enum, field_type)
        operations.append(op)
    response = ca_service.mutate_customer_assets(
        customer_id=customer_id, operations=operations
    )
    return [
        {"asset_id": asset_ids[i], "resource_name": r.resource_name}
        for i, r in enumerate(response.results)
    ]


def remove_customer_asset_links(
    client: GoogleAdsClient,
    customer_id: str,
    resource_names: list[str],
) -> list[dict[str, Any]]:
    """Detach customer-level asset links. Underlying Asset remains intact.

    resource_names look like 'customers/{cid}/customerAssets/{asset_id}~{field_type}'.
    """
    ca_service = client.get_service("CustomerAssetService")
    operations = []
    for rn in resource_names:
        op = client.get_type("CustomerAssetOperation")
        op.remove = rn
        operations.append(op)
    response = ca_service.mutate_customer_assets(
        customer_id=customer_id, operations=operations
    )
    return [
        {"resource_name": resource_names[i], "removed_resource_name": r.resource_name}
        for i, r in enumerate(response.results)
    ]


def link_assets_to_campaign(
    client: GoogleAdsClient,
    customer_id: str,
    campaign_id: int,
    asset_ids: list[int],
    field_type: str,
) -> list[dict[str, Any]]:
    """Attach Assets to a single campaign."""
    ca_service = client.get_service("CampaignAssetService")
    asset_service = client.get_service("AssetService")
    campaign_service = client.get_service("CampaignService")
    field_type_enum = client.enums.AssetFieldTypeEnum
    campaign_resource = campaign_service.campaign_path(customer_id, campaign_id)

    operations = []
    for aid in asset_ids:
        op = client.get_type("CampaignAssetOperation")
        link = op.create
        link.campaign = campaign_resource
        link.asset = asset_service.asset_path(customer_id, aid)
        link.field_type = getattr(field_type_enum, field_type)
        operations.append(op)
    response = ca_service.mutate_campaign_assets(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "campaign_id": campaign_id,
            "asset_id": asset_ids[i],
            "resource_name": r.resource_name,
        }
        for i, r in enumerate(response.results)
    ]


def spec_to_dict(spec: Any) -> dict[str, Any]:
    return asdict(spec)
