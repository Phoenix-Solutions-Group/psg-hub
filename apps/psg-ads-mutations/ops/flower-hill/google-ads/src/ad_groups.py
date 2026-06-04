def get_ad_group_by_name(client, customer_id: str, campaign_resource_name: str, name: str) -> str | None:
    ga_service = client.get_service("GoogleAdsService")
    safe_name = name.replace("'", "\\'")
    query = f"""
        SELECT ad_group.resource_name, ad_group.name
        FROM ad_group
        WHERE ad_group.campaign = '{campaign_resource_name}'
          AND ad_group.name = '{safe_name}'
          AND ad_group.status != 'REMOVED'
        LIMIT 1
    """
    try:
        for row in ga_service.search(customer_id=customer_id, query=query):
            print(f"    [ad group] already exists: {name}")
            return row.ad_group.resource_name
    except Exception:
        pass
    return None


def create_ad_group(
    client,
    customer_id: str,
    campaign_resource_name: str,
    name: str,
    cpc_bid_micros: int = 3_000_000,  # $3.00 default CPC
    status: str = "ENABLED",
) -> str:
    service = client.get_service("AdGroupService")
    op = client.get_type("AdGroupOperation")
    ad_group = op.create
    ad_group.name = name
    ad_group.campaign = campaign_resource_name
    ad_group.status = client.enums.AdGroupStatusEnum[status]
    ad_group.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
    ad_group.cpc_bid_micros = cpc_bid_micros
    response = service.mutate_ad_groups(customer_id=customer_id, operations=[op])
    resource_name = response.results[0].resource_name
    print(f"    [ad group] {name}")
    return resource_name
