def add_keywords_to_ad_group(
    client,
    customer_id: str,
    ad_group_resource_name: str,
    keywords: list[tuple[str, str]],  # [(text, match_type), ...]
) -> None:
    service = client.get_service("AdGroupCriterionService")
    ops = []
    for text, match_type in keywords:
        op = client.get_type("AdGroupCriterionOperation")
        criterion = op.create
        criterion.ad_group = ad_group_resource_name
        criterion.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        criterion.keyword.text = text
        criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[match_type]
        ops.append(op)
    if ops:
        service.mutate_ad_group_criteria(customer_id=customer_id, operations=ops)
    print(f"      [keywords] {len(ops)} keywords uploaded")
