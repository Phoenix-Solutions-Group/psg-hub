"""
Campaign-level assets: call, sitelink, callout, structured snippet.
Uses the Asset + CampaignAsset pattern (Google Ads API v18+).
"""


def _create_asset(client, customer_id: str, asset_op) -> str:
    service = client.get_service("AssetService")
    response = service.mutate_assets(customer_id=customer_id, operations=[asset_op])
    return response.results[0].resource_name


def _link_asset_to_campaign(
    client,
    customer_id: str,
    campaign_resource_name: str,
    asset_resource_name: str,
    field_type,
) -> None:
    service = client.get_service("CampaignAssetService")
    op = client.get_type("CampaignAssetOperation")
    link = op.create
    link.campaign = campaign_resource_name
    link.asset = asset_resource_name
    link.field_type = field_type
    service.mutate_campaign_assets(customer_id=customer_id, operations=[op])


def add_call_asset(
    client,
    customer_id: str,
    campaign_resource_name: str,
    phone_number: str,
    country_code: str = "US",
) -> None:
    op = client.get_type("AssetOperation")
    asset = op.create
    asset.call_asset.phone_number = phone_number
    asset.call_asset.country_code = country_code
    asset.call_asset.call_conversion_reporting_state = (
        client.enums.CallConversionReportingStateEnum.USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION
    )
    resource_name = _create_asset(client, customer_id, op)
    _link_asset_to_campaign(
        client,
        customer_id,
        campaign_resource_name,
        resource_name,
        client.enums.AssetFieldTypeEnum.CALL,
    )
    print(f"  [call asset] {phone_number}")


def add_sitelink_assets(
    client,
    customer_id: str,
    campaign_resource_name: str,
    sitelinks: list[dict],
) -> None:
    for sl in sitelinks:
        op = client.get_type("AssetOperation")
        asset = op.create
        asset.sitelink_asset.link_text = sl["text"]
        asset.sitelink_asset.description1 = sl["description_1"]
        asset.sitelink_asset.description2 = sl["description_2"]
        asset.final_urls.append(sl["final_url"])
        resource_name = _create_asset(client, customer_id, op)
        _link_asset_to_campaign(
            client,
            customer_id,
            campaign_resource_name,
            resource_name,
            client.enums.AssetFieldTypeEnum.SITELINK,
        )
    print(f"  [sitelinks] {len(sitelinks)} added")


def add_callout_assets(
    client,
    customer_id: str,
    campaign_resource_name: str,
    callout_texts: list[str],
) -> None:
    for text in callout_texts:
        op = client.get_type("AssetOperation")
        asset = op.create
        asset.callout_asset.callout_text = text
        resource_name = _create_asset(client, customer_id, op)
        _link_asset_to_campaign(
            client,
            customer_id,
            campaign_resource_name,
            resource_name,
            client.enums.AssetFieldTypeEnum.CALLOUT,
        )
    print(f"  [callouts] {len(callout_texts)} added")


def add_structured_snippet(
    client,
    customer_id: str,
    campaign_resource_name: str,
    header: str,
    values: list[str],
) -> None:
    op = client.get_type("AssetOperation")
    asset = op.create
    asset.structured_snippet_asset.header = header
    asset.structured_snippet_asset.values.extend(values)
    resource_name = _create_asset(client, customer_id, op)
    _link_asset_to_campaign(
        client,
        customer_id,
        campaign_resource_name,
        resource_name,
        client.enums.AssetFieldTypeEnum.STRUCTURED_SNIPPET,
    )
    print(f"  [snippet] {header}: {', '.join(values)}")
