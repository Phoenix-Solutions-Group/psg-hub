def create_campaign_budget(
    client,
    customer_id: str,
    name: str,
    daily_budget_micros: int,
) -> str:
    service = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    budget = op.create
    budget.name = name
    budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
    budget.amount_micros = daily_budget_micros
    budget.explicitly_shared = False
    response = service.mutate_campaign_budgets(customer_id=customer_id, operations=[op])
    resource_name = response.results[0].resource_name
    print(f"  [budget] {name} — ${daily_budget_micros / 1_000_000:.2f}/day")
    return resource_name
