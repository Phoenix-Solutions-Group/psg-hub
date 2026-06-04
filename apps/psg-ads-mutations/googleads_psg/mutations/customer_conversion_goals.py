"""CustomerConversionGoal mutations.

CustomerConversionGoal is the customer-level "primary goal" registry — it
lists which (category, origin) tuples count toward bidding optimization.
The `biddable` boolean is the lever:
  biddable=true  -> Smart Bidding optimizes toward this category+origin.
  biddable=false -> tracked but not optimized for.

This is the API path to demote a ConversionAction's primary_for_goal status
when the ConversionAction itself is immutable (REMOVED status, UA Goals,
or system-managed types like ANDROID_INSTALLS_ALL_OTHER_APPS).

Resource name format:
  customers/{cid}/customerConversionGoals/{category}~{origin}

Examples:
  customers/7763526490/customerConversionGoals/DOWNLOAD~APP
  customers/7763526490/customerConversionGoals/BOOK_APPOINTMENT~WEBSITE
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


@dataclass
class CustomerConversionGoalState:
    resource_name: str
    category: str
    origin: str
    biddable: bool


@dataclass
class CustomerConversionGoalChange:
    """Patch spec. category + origin form the resource key."""
    category: str  # e.g. 'DOWNLOAD', 'BOOK_APPOINTMENT'
    origin: str    # e.g. 'APP', 'WEBSITE', 'CALL_FROM_ADS', 'GOOGLE_HOSTED'
    biddable: bool


def fetch_state(
    client: GoogleAdsClient, customer_id: str
) -> list[CustomerConversionGoalState]:
    """Read all CustomerConversionGoal entries for the account."""
    ga_service = client.get_service("GoogleAdsService")
    query = """
        SELECT
          customer_conversion_goal.resource_name,
          customer_conversion_goal.category,
          customer_conversion_goal.origin,
          customer_conversion_goal.biddable
        FROM customer_conversion_goal
    """
    states: list[CustomerConversionGoalState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        g = row.customer_conversion_goal
        states.append(
            CustomerConversionGoalState(
                resource_name=g.resource_name,
                category=g.category.name,
                origin=g.origin.name,
                biddable=bool(g.biddable),
            )
        )
    return states


def apply_changes(
    client: GoogleAdsClient,
    customer_id: str,
    changes: list[CustomerConversionGoalChange],
) -> list[dict[str, Any]]:
    """Update biddable flag on CustomerConversionGoal entries."""
    ccg_service = client.get_service("CustomerConversionGoalService")

    operations = []
    update_masks_for_log: list[list[str]] = []

    for change in changes:
        op = client.get_type("CustomerConversionGoalOperation")
        g = op.update
        g.resource_name = (
            f"customers/{customer_id}/customerConversionGoals/"
            f"{change.category}~{change.origin}"
        )
        g.biddable = change.biddable

        # Explicit mask path. bool=False would otherwise be dropped from the
        # inferred mask (see Phase 1 lib bug notes).
        op.update_mask.paths.append("biddable")
        operations.append(op)
        update_masks_for_log.append(["biddable"])

    response = ccg_service.mutate_customer_conversion_goals(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "category": changes[i].category,
            "origin": changes[i].origin,
            "resource_name": r.resource_name,
            "updated_fields": mask,
        }
        for i, (r, mask) in enumerate(zip(response.results, update_masks_for_log))
    ]


def state_to_dicts(states: list[CustomerConversionGoalState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]


def changes_to_dicts(changes: list[CustomerConversionGoalChange]) -> list[dict[str, Any]]:
    return [asdict(c) for c in changes]
