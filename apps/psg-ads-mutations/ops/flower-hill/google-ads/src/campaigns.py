def get_campaign_by_name(client, customer_id: str, name: str) -> str | None:
    """Return resource name if campaign already exists, else None."""
    ga_service = client.get_service("GoogleAdsService")
    query = f"""
        SELECT campaign.resource_name, campaign.name
        FROM campaign
        WHERE campaign.name = '{name}'
          AND campaign.status != 'REMOVED'
        LIMIT 1
    """
    try:
        for row in ga_service.search(customer_id=customer_id, query=query):
            print(f"  [campaign] already exists: {name}")
            return row.campaign.resource_name
    except Exception:
        pass
    return None


def create_search_campaign(
    client,
    customer_id: str,
    name: str,
    budget_resource_name: str,
    status: str = "PAUSED",
) -> str:
    service = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    campaign = op.create
    campaign.name = name
    campaign.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
    campaign.status = client.enums.CampaignStatusEnum[status]
    campaign.campaign_budget = budget_resource_name
    campaign.manual_cpc = client.get_type("ManualCpc")
    # Enum 3 = DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
    campaign.contains_eu_political_advertising = 3
    # Network: Search + Search Partners only (no Display)
    campaign.network_settings.target_google_search = True
    campaign.network_settings.target_search_network = True
    campaign.network_settings.target_content_network = False
    response = service.mutate_campaigns(customer_id=customer_id, operations=[op])
    resource_name = response.results[0].resource_name
    print(f"  [campaign] {name}")
    return resource_name


def add_geo_proximity_target(
    client,
    customer_id: str,
    campaign_resource_name: str,
    lat: float,
    lng: float,
    radius_miles: float,
) -> str:
    service = client.get_service("CampaignCriterionService")
    op = client.get_type("CampaignCriterionOperation")
    criterion = op.create
    criterion.campaign = campaign_resource_name
    criterion.proximity.geo_point.longitude_in_micro_degrees = int(lng * 1_000_000)
    criterion.proximity.geo_point.latitude_in_micro_degrees = int(lat * 1_000_000)
    criterion.proximity.radius = radius_miles
    criterion.proximity.radius_units = client.enums.ProximityRadiusUnitsEnum.MILES
    response = service.mutate_campaign_criteria(customer_id=customer_id, operations=[op])
    return response.results[0].resource_name


def add_negative_keywords_to_campaign(
    client,
    customer_id: str,
    campaign_resource_name: str,
    negative_keywords: list[str],
) -> None:
    service = client.get_service("CampaignCriterionService")
    ops = []
    for kw in negative_keywords:
        op = client.get_type("CampaignCriterionOperation")
        criterion = op.create
        criterion.campaign = campaign_resource_name
        criterion.negative = True
        criterion.keyword.text = kw
        criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum.BROAD
        ops.append(op)
    if ops:
        service.mutate_campaign_criteria(customer_id=customer_id, operations=ops)
    print(f"  [negatives] {len(ops)} negative keywords added")
