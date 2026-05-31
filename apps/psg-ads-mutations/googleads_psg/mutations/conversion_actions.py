"""Conversion action mutations.

The main lever for Smart Bidding signal hygiene is `include_in_conversions_metric`.
When False, the action is still tracked but not counted in the 'Conversions' metric,
so Smart Bidding does not optimize toward it. This is safer than deletion because
it preserves historical data and is fully reversible.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from google.ads.googleads.client import GoogleAdsClient


@dataclass
class ConversionActionState:
    id: int
    name: str
    status: str
    category: str
    type: str
    primary_for_goal: bool
    include_in_conversions_metric: bool
    counting_type: str
    default_value: float
    always_use_default_value: bool


@dataclass
class ConversionActionChange:
    """Patch spec. Only set fields you want to change; None = leave alone."""
    conversion_action_id: int
    include_in_conversions_metric: bool | None = None
    counting_type: str | None = None  # "ONE_PER_CLICK" or "MANY_PER_CLICK"
    default_value: float | None = None
    always_use_default_value: bool | None = None


def fetch_state(
    client: GoogleAdsClient, customer_id: str, conversion_action_ids: list[int]
) -> list[ConversionActionState]:
    """Read current state of the given conversion actions."""
    ga_service = client.get_service("GoogleAdsService")
    ids_sql = ", ".join(str(i) for i in conversion_action_ids)
    query = f"""
        SELECT
          conversion_action.id,
          conversion_action.name,
          conversion_action.status,
          conversion_action.category,
          conversion_action.type,
          conversion_action.primary_for_goal,
          conversion_action.include_in_conversions_metric,
          conversion_action.counting_type,
          conversion_action.value_settings.default_value,
          conversion_action.value_settings.always_use_default_value
        FROM conversion_action
        WHERE conversion_action.id IN ({ids_sql})
    """
    states: list[ConversionActionState] = []
    for row in ga_service.search(customer_id=customer_id, query=query):
        ca = row.conversion_action
        states.append(
            ConversionActionState(
                id=ca.id,
                name=ca.name,
                status=ca.status.name,
                category=ca.category.name,
                type=ca.type_.name,
                primary_for_goal=bool(ca.primary_for_goal),
                include_in_conversions_metric=bool(ca.include_in_conversions_metric),
                counting_type=ca.counting_type.name,
                default_value=float(ca.value_settings.default_value),
                always_use_default_value=bool(ca.value_settings.always_use_default_value),
            )
        )
    return states


def apply_changes(
    client: GoogleAdsClient,
    customer_id: str,
    changes: list[ConversionActionChange],
) -> list[dict[str, Any]]:
    """Mutate conversion actions. Returns list of API responses per operation."""
    ca_service = client.get_service("ConversionActionService")
    counting_enum = client.enums.ConversionActionCountingTypeEnum

    operations = []
    update_masks_for_log: list[list[str]] = []

    for change in changes:
        op = client.get_type("ConversionActionOperation")
        ca = op.update
        ca.resource_name = ca_service.conversion_action_path(
            customer_id, change.conversion_action_id
        )
        updated_fields: list[str] = []

        if change.include_in_conversions_metric is not None:
            ca.include_in_conversions_metric = change.include_in_conversions_metric
            updated_fields.append("include_in_conversions_metric")

        if change.counting_type is not None:
            ca.counting_type = getattr(counting_enum, change.counting_type)
            updated_fields.append("counting_type")

        if change.default_value is not None:
            ca.value_settings.default_value = change.default_value
            updated_fields.append("value_settings.default_value")

        if change.always_use_default_value is not None:
            ca.value_settings.always_use_default_value = change.always_use_default_value
            updated_fields.append("value_settings.always_use_default_value")

        # Build update_mask explicitly. protobuf_helpers.field_mask() infers from
        # non-default values, so setting bool=False (proto default) gets dropped
        # and the API silently no-ops the change.
        op.update_mask.paths.extend(updated_fields)
        operations.append(op)
        update_masks_for_log.append(updated_fields)

    response = ca_service.mutate_conversion_actions(
        customer_id=customer_id, operations=operations
    )
    return [
        {
            "conversion_action_id": changes[i].conversion_action_id,
            "ok": True,
            "resource_name": r.resource_name,
            "updated_fields": mask,
        }
        for i, (r, mask) in enumerate(zip(response.results, update_masks_for_log))
    ]


def state_to_dicts(states: list[ConversionActionState]) -> list[dict[str, Any]]:
    return [asdict(s) for s in states]


def changes_to_dicts(changes: list[ConversionActionChange]) -> list[dict[str, Any]]:
    return [asdict(c) for c in changes]
