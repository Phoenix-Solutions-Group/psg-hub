def create_rsa(
    client,
    customer_id: str,
    ad_group_resource_name: str,
    headlines: list[str],
    descriptions: list[str],
    final_url: str,
    path1: str = "",
    path2: str = "",
) -> str:
    service = client.get_service("AdGroupAdService")
    op = client.get_type("AdGroupAdOperation")
    ad_group_ad = op.create
    ad_group_ad.ad_group = ad_group_resource_name
    ad_group_ad.status = client.enums.AdGroupAdStatusEnum.PAUSED

    rsa = ad_group_ad.ad.responsive_search_ad

    for text in headlines[:15]:
        asset = client.get_type("AdTextAsset")
        asset.text = text
        rsa.headlines.append(asset)

    for text in descriptions[:4]:
        asset = client.get_type("AdTextAsset")
        asset.text = text
        rsa.descriptions.append(asset)

    ad_group_ad.ad.final_urls.append(final_url)

    if path1:
        rsa.path1 = path1
    if path2:
        rsa.path2 = path2

    response = service.mutate_ad_group_ads(customer_id=customer_id, operations=[op])
    resource_name = response.results[0].resource_name
    print(f"      [rsa] created — {len(headlines)} headlines, {len(descriptions)} descriptions")
    return resource_name
