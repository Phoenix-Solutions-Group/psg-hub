#!/usr/bin/env python3
"""PSG Ads Mutation Studio — sandbox runner / dispatch harness.

Invoked by the Node `VercelSandboxBridge` INSIDE a Vercel Sandbox, once per job:

    python runner.py --job '<JobSpec JSON>'
    python runner.py --job-file /path/to/job.json

JobSpec (the bridge's contract):
    {
      "mutationKey": "google_ads.campaign_bidding",
      "mode": "dry_run" | "execute",
      "targetRef": "1234567890",          # Google Ads customer id OR GTM container public id
      "params": { ... }                    # per-mutation params (see registry.ts)
    }

It bootstraps the right client (`googleads_psg.client.load_client()` for Google Ads,
`gtm_psg.client.load_gtm_service()` for GTM), dispatches by registry key to a
PER-MUTATION ADAPTER, and prints a single sentinel-framed JSON result to stdout:

    __PSG_ADS_RESULT_BEGIN__
    {"ok": true, "before": ..., "requestedChanges": ..., "after": ..., "log": {...}}
    __PSG_ADS_RESULT_END__

WHY PER-MUTATION ADAPTERS (not naive import+call): the shipped mutation modules have
NON-UNIFORM signatures — some take a single `campaign_id`, some a `campaign_ids` list,
some take dataclass lists (`CampaignBiddingChange`, `NegativeKeyword`, ...), GTM ops take
a `service` + resolved resource *paths* and need a container→workspace→tag walk first.
Each adapter normalizes the JobSpec params into the exact call that module expects and
serializes the result via that module's `*_to_dicts` / `spec_to_dict` helpers.

DRY-RUN SAFETY: the shipped apply functions have no `validate_only` flag, so dry-run NEVER
calls the mutating function. It returns the live before-state (via fetchFn) plus the
validated requested-changes (constructing the dataclasses runs their `__post_init__`
validation), and a null `after`. Only `mode == "execute"` calls the apply function.

Imports of the Google SDK modules are LAZY (inside adapters) so this file byte-compiles
and unit-imports without google-ads / google-api-python-client installed; they are only
present inside the sandbox after `pip install -e apps/psg-ads-mutations`.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from typing import Any, Callable

RESULT_BEGIN = "__PSG_ADS_RESULT_BEGIN__"
RESULT_END = "__PSG_ADS_RESULT_END__"

VALID_MODES = ("dry_run", "execute")


# ── Google Ads adapters ─────────────────────────────────────────────────────────
# Each adapter: (client: GoogleAdsClient, customer_id: str, params: dict, mode: str)
#   -> (before, requested_changes, after)

def _adapt_negative_keywords(client, customer_id, params, mode):
    from googleads_psg.mutations import negative_keywords as m

    campaign_id = int(params["campaign_id"])
    negatives = [
        m.NegativeKeyword(text=n["text"], match_type=n["match_type"])
        for n in params["negatives"]
    ]
    before = m.state_to_dicts(
        m.fetch_existing_negatives(client, customer_id, [campaign_id])
    )
    requested = m.negatives_to_dicts(negatives)
    after = None
    if mode == "execute":
        after = m.add_campaign_negatives(client, customer_id, campaign_id, negatives)
    return before, requested, after


def _adapt_assets(client, customer_id, params, mode):
    from googleads_psg.mutations import assets as m

    asset_type = str(params.get("asset_type") or "sitelink").lower()
    builders = {
        "sitelink": (m.SitelinkSpec, m.create_sitelink_assets),
        "callout": (m.CalloutSpec, m.create_callout_assets),
        "structured_snippet": (m.StructuredSnippetSpec, m.create_structured_snippet_assets),
        "snippet": (m.StructuredSnippetSpec, m.create_structured_snippet_assets),
        "call": (m.CallSpec, m.create_call_assets),
    }
    if asset_type not in builders:
        raise ValueError(
            f"unsupported asset_type={asset_type!r}; supported: "
            f"{sorted(set(builders) - {'snippet'})} (image uploads are out of Studio scope)"
        )
    spec_cls, create_fn = builders[asset_type]
    specs = [spec_cls(**s) for s in params["specs"]]
    requested = [m.spec_to_dict(s) for s in specs]
    after = None
    if mode == "execute":
        asset_ids = create_fn(client, customer_id, specs)
        after = [{"asset_id": aid, "asset_type": asset_type} for aid in asset_ids]
    # Asset creation has no readable prior state (fetchFn is null in the registry).
    return None, requested, after


def _adapt_geo_targets(client, customer_id, params, mode):
    from googleads_psg.mutations import geo_targets as m

    campaign_id = int(params["campaign_id"])
    geo_ids = [int(g) for g in params["geo_target_ids"]]
    before = m.state_to_dicts(
        m.fetch_campaign_locations(client, customer_id, [campaign_id])
    )
    requested = [{"campaign_id": campaign_id, "geo_target_id": g} for g in geo_ids]
    after = None
    if mode == "execute":
        after = m.add_campaign_locations(client, customer_id, campaign_id, geo_ids)
    return before, requested, after


def _adapt_campaign_bidding(client, customer_id, params, mode):
    from googleads_psg.mutations import campaign_bidding as m

    changes = [
        m.CampaignBiddingChange(
            campaign_id=int(c["campaign_id"]),
            strategy=c["strategy"],
            target_cpa_micros=c.get("target_cpa_micros"),
            target_roas=c.get("target_roas"),
        )
        for c in params["changes"]
    ]
    campaign_ids = [c.campaign_id for c in changes]
    before = m.state_to_dicts(m.fetch_state(client, customer_id, campaign_ids))
    requested = m.changes_to_dicts(changes)
    after = None
    if mode == "execute":
        after = m.apply_changes(client, customer_id, changes)
    return before, requested, after


def _adapt_campaign_device_bids(client, customer_id, params, mode):
    from googleads_psg.mutations import campaign_device_bids as m

    changes = [
        m.DeviceBidModChange(
            campaign_id=int(c["campaign_id"]),
            device=c["device"],
            bid_modifier=float(c["bid_modifier"]),
        )
        for c in params["changes"]
    ]
    campaign_ids = [c.campaign_id for c in changes]
    before = m.state_to_dicts(m.fetch_state(client, customer_id, campaign_ids))
    requested = m.changes_to_dicts(changes)
    after = None
    if mode == "execute":
        after = m.apply_changes(client, customer_id, changes)
    return before, requested, after


def _adapt_campaign_network(client, customer_id, params, mode):
    from googleads_psg.mutations import campaign_network as m

    changes = [
        m.CampaignNetworkChange(
            campaign_id=int(c["campaign_id"]),
            target_google_search=c.get("target_google_search"),
            target_search_network=c.get("target_search_network"),
            target_content_network=c.get("target_content_network"),
            target_partner_search_network=c.get("target_partner_search_network"),
        )
        for c in params["changes"]
    ]
    campaign_ids = [c.campaign_id for c in changes]
    before = m.state_to_dicts(m.fetch_state(client, customer_id, campaign_ids))
    requested = m.changes_to_dicts(changes)
    after = None
    if mode == "execute":
        after = m.apply_changes(client, customer_id, changes)
    return before, requested, after


def _adapt_conversion_actions(client, customer_id, params, mode):
    from googleads_psg.mutations import conversion_actions as m

    changes = [
        m.ConversionActionChange(
            conversion_action_id=int(c["conversion_action_id"]),
            include_in_conversions_metric=c.get("include_in_conversions_metric"),
            counting_type=c.get("counting_type"),
            default_value=c.get("default_value"),
            always_use_default_value=c.get("always_use_default_value"),
        )
        for c in params["changes"]
    ]
    ids = [c.conversion_action_id for c in changes]
    before = m.state_to_dicts(m.fetch_state(client, customer_id, ids))
    requested = m.changes_to_dicts(changes)
    after = None
    if mode == "execute":
        after = m.apply_changes(client, customer_id, changes)
    return before, requested, after


def _adapt_customer_conversion_goals(client, customer_id, params, mode):
    from googleads_psg.mutations import customer_conversion_goals as m

    changes = [
        m.CustomerConversionGoalChange(
            category=c["category"],
            origin=c["origin"],
            biddable=bool(c["biddable"]),
        )
        for c in params["changes"]
    ]
    # fetch_state for this op takes NO ids — it reads all account-level goals.
    before = m.state_to_dicts(m.fetch_state(client, customer_id))
    requested = m.changes_to_dicts(changes)
    after = None
    if mode == "execute":
        after = m.apply_changes(client, customer_id, changes)
    return before, requested, after


# ── GTM adapters ─────────────────────────────────────────────────────────────────
# Each adapter: (service: Resource, container_public_id: str, params: dict, mode: str)
#   -> (before, requested_changes, after)
# GTM ops need a container→workspace→resource walk before they can act.

def _adapt_gtm_tag_paused(service, container_public_id, params, mode):
    from gtm_psg.mutations import tags as m

    tag_name = params["tag_name"]
    paused = bool(params["paused"])
    container = m.resolve_container(service, container_public_id)
    workspace = m.get_default_workspace(service, container["path"])
    existing = m.list_tags(service, workspace["path"])
    tag = m.find_tag(existing, tag_name)
    before = {
        "tag_name": tag_name,
        "found": tag is not None,
        "paused": (tag.get("paused") if tag else None),
    }
    requested = {"tag_name": tag_name, "paused": paused}
    after = None
    if mode == "execute":
        if not tag:
            raise ValueError(
                f"GTM tag {tag_name!r} not found in container {container_public_id!r}"
            )
        updated = m.set_tag_paused(service, tag["path"], paused)
        after = {
            "tag_name": updated.get("name"),
            "tagId": updated.get("tagId"),
            "paused": updated.get("paused"),
        }
    return before, requested, after


def _adapt_gtm_publish_version(service, container_public_id, params, mode):
    from gtm_psg.mutations import tags as m

    notes = params["notes"]
    container = m.resolve_container(service, container_public_id)
    workspace = m.get_default_workspace(service, container["path"])
    requested = {
        "container": container_public_id,
        "workspace": workspace.get("name"),
        "notes": notes,
    }
    after = None
    if mode == "execute":
        version, publish = m.create_version_and_publish(service, workspace["path"], notes)
        after = {
            "versionId": version.get("containerVersionId"),
            "name": version.get("name"),
            "published": True,
            "publish_response": publish,
        }
    # Publishing has no meaningful readable prior state (fetchFn is null).
    return None, requested, after


GOOGLE_ADS_ADAPTERS: dict[str, Callable] = {
    "google_ads.negative_keywords": _adapt_negative_keywords,
    "google_ads.assets": _adapt_assets,
    "google_ads.geo_targets": _adapt_geo_targets,
    "google_ads.campaign_bidding": _adapt_campaign_bidding,
    "google_ads.campaign_device_bids": _adapt_campaign_device_bids,
    "google_ads.campaign_network": _adapt_campaign_network,
    "google_ads.conversion_actions": _adapt_conversion_actions,
    "google_ads.customer_conversion_goals": _adapt_customer_conversion_goals,
}

GTM_ADAPTERS: dict[str, Callable] = {
    "gtm.tag_paused": _adapt_gtm_tag_paused,
    "gtm.publish_version": _adapt_gtm_publish_version,
}


def dispatch(spec: dict[str, Any]) -> dict[str, Any]:
    """Run one JobSpec and return the result dict (before raising on error)."""
    key = spec.get("mutationKey")
    mode = spec.get("mode")
    target = spec.get("targetRef")
    params = spec.get("params") or {}

    if not key:
        raise ValueError("JobSpec.mutationKey is required")
    if mode not in VALID_MODES:
        raise ValueError(f"JobSpec.mode must be one of {VALID_MODES}, got {mode!r}")
    if not target:
        raise ValueError("JobSpec.targetRef is required (customer id / container id)")

    if key in GOOGLE_ADS_ADAPTERS:
        from googleads_psg.client import load_client

        client = load_client()
        before, requested, after = GOOGLE_ADS_ADAPTERS[key](client, target, params, mode)
    elif key in GTM_ADAPTERS:
        from gtm_psg.client import load_gtm_service

        service = load_gtm_service()
        before, requested, after = GTM_ADAPTERS[key](service, target, params, mode)
    else:
        raise ValueError(f"unknown mutationKey {key!r}")

    log = {
        "op": key,
        "target": target,
        "mode": mode,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "before": before,
        "requested_changes": requested,
        "after": after,
    }
    return {
        "ok": True,
        "mutationKey": key,
        "mode": mode,
        "before": before,
        "requestedChanges": requested,
        "after": after,
        "log": log,
    }


def _emit(payload: dict[str, Any]) -> None:
    """Print the sentinel-framed JSON the bridge parses."""
    print(RESULT_BEGIN)
    print(json.dumps(payload, default=str))
    print(RESULT_END)


def _load_spec(args: argparse.Namespace) -> dict[str, Any]:
    if args.job_file:
        with open(args.job_file, "r", encoding="utf-8") as fh:
            return json.load(fh)
    if args.job:
        return json.loads(args.job)
    raise ValueError("one of --job or --job-file is required")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PSG Ads Mutation Studio sandbox runner")
    parser.add_argument("--job", help="JobSpec as a JSON string")
    parser.add_argument("--job-file", help="path to a JobSpec JSON file")
    args = parser.parse_args(argv)

    try:
        spec = _load_spec(args)
    except Exception as exc:  # noqa: BLE001 — top-level boundary, must always emit JSON
        _emit({"ok": False, "errorType": "BadJobSpec", "error": str(exc)})
        return 2

    try:
        result = dispatch(spec)
    except Exception as exc:  # noqa: BLE001 — top-level boundary, must always emit JSON
        _emit(
            {
                "ok": False,
                "errorType": type(exc).__name__,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
        return 1

    _emit(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
