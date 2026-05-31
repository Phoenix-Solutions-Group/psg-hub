"""
Wallace Collision Center — expand Tesla + JLR Q2 keywords; bump Tesla ad-group bid.

Diagnosis (2026-05-21, last 7d, post Q2 cutover):
  GOOG_WAL_SRCH_TeslaApproved_2026Q2 (23825006339)
    ad group "Tesla Approved Collision" (195506903479) default $20.00 CPC
    7 keywords, all narrow EXACT/PHRASE on "approved/certified" phrasing
    3 imp / 0 clicks / 0 conv in 7d; 75% IS, 25% rank lost
  GOOG_WAL_SRCH_JLRCertified_2026Q2 (23819664216)
    ad group "JLR Certified Collision" (199839184481) default $25.00 CPC
    8 keywords, all narrow EXACT/PHRASE on "certified" phrasing
    0 imp in 7d
  Root cause: hyper-restrictive keyword set; Tri-Cities TN search volume
  for "<make> certified body shop" is near zero. Bids + budgets fine.

Changes:
  Tesla Q2
    1. Bump ad-group "Tesla Approved Collision" default CPC $20 -> $25.
    2. Add 5 PHRASE keywords on the same ad group:
         "tesla collision repair"
         "tesla body repair"
         "tesla auto body"
         "tesla bodywork"
         "certified tesla repair"
  JLR Q2
    3. Add 8 PHRASE keywords on the "JLR Certified Collision" ad group:
         "land rover body shop"
         "land rover collision repair"
         "jaguar body shop"
         "jaguar collision repair"
         "range rover body shop"
         "range rover collision repair"
         "jaguar repair near me"
         "land rover repair near me"

Budgets unchanged (both stay $30/day = ~$912/mo). Bidding strategy unchanged
(both stay MANUAL_CPC — 0 conv history means Max Conv would cold-start
indefinitely).

Pre-flight verified: campaign negatives ("service near me", "land rover service",
"jaguar service", "dealership" PHRASE, "parts" PHRASE, "for sale" PHRASE, "used"
PHRASE) will not block any of the new phrase keywords (broad negatives require
all tokens; phrase negatives require ordered tokens).

Run: python -m ops.wallace.expand_tesla_jlr_q2_keywords --dry-run
Run: python -m ops.wallace.expand_tesla_jlr_q2_keywords --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.protobuf import field_mask_pb2

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client

CUSTOMER_ID = "6048611995"

TESLA_CAMPAIGN_ID = 23825006339
TESLA_AD_GROUP_ID = 195506903479
TESLA_NEW_BID_MICROS = 25_000_000  # $25.00

JLR_CAMPAIGN_ID = 23819664216
JLR_AD_GROUP_ID = 199839184481

TESLA_PHRASE_KEYWORDS: list[str] = [
    "tesla collision repair",
    "tesla body repair",
    "tesla auto body",
    "tesla bodywork",
    "certified tesla repair",
]

JLR_PHRASE_KEYWORDS: list[str] = [
    "land rover body shop",
    "land rover collision repair",
    "jaguar body shop",
    "jaguar collision repair",
    "range rover body shop",
    "range rover collision repair",
    "jaguar repair near me",
    "land rover repair near me",
]


def fetch_ad_group(client, ad_group_id: int) -> dict:
    ga = client.get_service("GoogleAdsService")
    q = f"""
        SELECT ad_group.id, ad_group.name, ad_group.status,
               ad_group.cpc_bid_micros,
               campaign.id, campaign.name
        FROM ad_group
        WHERE ad_group.id = {ad_group_id}
    """
    for row in ga.search(customer_id=CUSTOMER_ID, query=q):
        return {
            "id": row.ad_group.id,
            "name": row.ad_group.name,
            "status": row.ad_group.status.name,
            "cpc_bid_micros": row.ad_group.cpc_bid_micros,
            "campaign_id": row.campaign.id,
            "campaign_name": row.campaign.name,
        }
    raise RuntimeError(f"Ad group {ad_group_id} not found")


def fetch_keywords(client, ad_group_id: int) -> list[dict]:
    ga = client.get_service("GoogleAdsService")
    q = f"""
        SELECT ad_group_criterion.criterion_id,
               ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type,
               ad_group_criterion.status,
               ad_group_criterion.negative
        FROM ad_group_criterion
        WHERE ad_group.id = {ad_group_id}
          AND ad_group_criterion.type = 'KEYWORD'
          AND ad_group_criterion.negative = false
    """
    out = []
    for row in ga.search(customer_id=CUSTOMER_ID, query=q):
        c = row.ad_group_criterion
        out.append({
            "criterion_id": c.criterion_id,
            "text": c.keyword.text,
            "match_type": c.keyword.match_type.name,
            "status": c.status.name,
        })
    return out


def fetch_state(client) -> dict:
    return {
        "tesla": {
            "ad_group": fetch_ad_group(client, TESLA_AD_GROUP_ID),
            "keywords": fetch_keywords(client, TESLA_AD_GROUP_ID),
        },
        "jlr": {
            "ad_group": fetch_ad_group(client, JLR_AD_GROUP_ID),
            "keywords": fetch_keywords(client, JLR_AD_GROUP_ID),
        },
    }


def _missing(existing: list[dict], desired: list[str], match_type: str) -> list[str]:
    have = {(k["text"].lower(), k["match_type"]) for k in existing}
    return [t for t in desired if (t.lower(), match_type) not in have]


def apply_changes(client, before: dict) -> dict:
    out: dict = {}

    # 1. Bump Tesla ad-group default bid 20M -> 25M
    ags = client.get_service("AdGroupService")
    agop = client.get_type("AdGroupOperation")
    agop.update.resource_name = ags.ad_group_path(CUSTOMER_ID, TESLA_AD_GROUP_ID)
    agop.update.cpc_bid_micros = TESLA_NEW_BID_MICROS
    agop.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["cpc_bid_micros"]))
    agres = ags.mutate_ad_groups(customer_id=CUSTOMER_ID, operations=[agop])
    out["tesla_bid_bump"] = {"resource_name": agres.results[0].resource_name}

    # 2. Add Tesla phrase keywords
    agcs = client.get_service("AdGroupCriterionService")
    tesla_missing = _missing(before["tesla"]["keywords"], TESLA_PHRASE_KEYWORDS, "PHRASE")
    if tesla_missing:
        tesla_ag_resource = ags.ad_group_path(CUSTOMER_ID, TESLA_AD_GROUP_ID)
        ops = []
        for t in tesla_missing:
            kop = client.get_type("AdGroupCriterionOperation")
            crit = kop.create
            crit.ad_group = tesla_ag_resource
            crit.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            crit.keyword.text = t
            crit.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
            ops.append(kop)
        kres = agcs.mutate_ad_group_criteria(customer_id=CUSTOMER_ID, operations=ops)
        out["tesla_keywords_added"] = [
            {"resource_name": r.resource_name, "text": tesla_missing[i]}
            for i, r in enumerate(kres.results)
        ]
    else:
        out["tesla_keywords_added"] = []

    # 3. Add JLR phrase keywords
    jlr_missing = _missing(before["jlr"]["keywords"], JLR_PHRASE_KEYWORDS, "PHRASE")
    if jlr_missing:
        jlr_ag_resource = ags.ad_group_path(CUSTOMER_ID, JLR_AD_GROUP_ID)
        ops = []
        for t in jlr_missing:
            kop = client.get_type("AdGroupCriterionOperation")
            crit = kop.create
            crit.ad_group = jlr_ag_resource
            crit.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
            crit.keyword.text = t
            crit.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
            ops.append(kop)
        kres = agcs.mutate_ad_group_criteria(customer_id=CUSTOMER_ID, operations=ops)
        out["jlr_keywords_added"] = [
            {"resource_name": r.resource_name, "text": jlr_missing[i]}
            for i, r in enumerate(kres.results)
        ]
    else:
        out["jlr_keywords_added"] = []

    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = not args.execute

    client = load_client()

    print("\n=== Wallace Tesla + JLR Q2 Keyword Expansion ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")

    before = fetch_state(client)

    for camp in ("tesla", "jlr"):
        ag = before[camp]["ad_group"]
        kws = before[camp]["keywords"]
        print(f"\n--- {camp.upper()} before ---")
        print(f"  Campaign: {ag['campaign_name']}  (status {ag['status']})")
        print(f"  Ad group: {ag['name']} ({ag['id']})  "
              f"bid ${ag['cpc_bid_micros']/1_000_000:.2f}")
        print(f"  Existing positive keywords: {len(kws)}")
        for k in kws:
            print(f"    [{k['text']}] {k['match_type']} {k['status']}")

    tesla_missing = _missing(before["tesla"]["keywords"], TESLA_PHRASE_KEYWORDS, "PHRASE")
    jlr_missing = _missing(before["jlr"]["keywords"], JLR_PHRASE_KEYWORDS, "PHRASE")

    planned = {
        "tesla_bid_bump": {
            "from_micros": before["tesla"]["ad_group"]["cpc_bid_micros"],
            "to_micros": TESLA_NEW_BID_MICROS,
        },
        "tesla_keywords_to_add": [
            {"text": t, "match_type": "PHRASE"} for t in tesla_missing
        ],
        "jlr_keywords_to_add": [
            {"text": t, "match_type": "PHRASE"} for t in jlr_missing
        ],
    }

    print("\n--- Planned changes ---")
    print(f"  Tesla ad-group bid: "
          f"${before['tesla']['ad_group']['cpc_bid_micros']/1_000_000:.2f} "
          f"-> ${TESLA_NEW_BID_MICROS/1_000_000:.2f}")
    print(f"  Tesla keywords to add (PHRASE): {len(tesla_missing)}")
    for t in tesla_missing:
        print(f"    \"{t}\"")
    print(f"  JLR keywords to add (PHRASE): {len(jlr_missing)}")
    for t in jlr_missing:
        print(f"    \"{t}\"")

    if dry_run:
        write_audit(
            op_name="wallace-expand-tesla-jlr-q2-keywords",
            customer_id=CUSTOMER_ID,
            before=before,
            changes=planned,
            after=None,
            dry_run=True,
        )
        print("\n[DRY RUN] No changes applied. Re-run with --execute to commit.")
        return

    print("\n=== Applying changes ===")
    results = apply_changes(client, before)
    for k, v in results.items():
        if isinstance(v, list):
            print(f"  [OK] {k}: {len(v)} items")
            for item in v:
                print(f"       - {item}")
        else:
            print(f"  [OK] {k}: {v}")

    after = fetch_state(client)
    write_audit(
        op_name="wallace-expand-tesla-jlr-q2-keywords",
        customer_id=CUSTOMER_ID,
        before=before,
        changes=planned,
        after=after,
        dry_run=False,
    )

    for camp in ("tesla", "jlr"):
        ag = after[camp]["ad_group"]
        kws = after[camp]["keywords"]
        print(f"\n--- {camp.upper()} after ---")
        print(f"  Ad group bid: ${ag['cpc_bid_micros']/1_000_000:.2f}")
        print(f"  Positive keywords: {len(kws)}")
        for k in kws:
            print(f"    [{k['text']}] {k['match_type']}")

    print("\nDone. Monitor 7 days. Expected: Tesla 30-80 imp/d, JLR 15-40 imp/d.")


if __name__ == "__main__":
    main()
