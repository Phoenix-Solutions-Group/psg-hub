"""
Wallace Collision Center — OEM-generic negative keyword rollout.

Adds PHRASE-match negatives across OEM-certified campaigns to block
dealership / parts / service / model-year queries that bled ~$540 / 30d.

Targets (campaign_id → name):
  19730091513  Tesla Approved              (legacy, recently paused)
  21269931336  JLR Certified Collision Repairs (legacy)
  18000555493  BMW Certified               (paused)
  21460658316  Rivian Approved             (paused)
  23825006339  GOOG_WAL_SRCH_TeslaApproved_2026Q2
  23819664216  GOOG_WAL_SRCH_JLRCertified_2026Q2
  23819659089  GOOG_WAL_SRCH_ToyotaCertified_2026Q2

Wallace Ford of Kingsport Brand (22896707513) is intentionally excluded.

Run: python -m ops.wallace.add_oem_negatives --dry-run
Run: python -m ops.wallace.add_oem_negatives --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client
from googleads_psg.mutations.negative_keywords import (
    NegativeKeyword,
    add_campaign_negatives,
    fetch_existing_negatives,
    negatives_to_dicts,
    state_to_dicts,
)

CUSTOMER_ID = "6048611995"

TARGET_CAMPAIGNS: dict[int, str] = {
    19730091513: "Tesla Approved",
    21269931336: "JLR Certified Collision Repairs",
    18000555493: "BMW Certified",
    21460658316: "Rivian Approved",
    23825006339: "GOOG_WAL_SRCH_TeslaApproved_2026Q2",
    23819664216: "GOOG_WAL_SRCH_JLRCertified_2026Q2",
    23819659089: "GOOG_WAL_SRCH_ToyotaCertified_2026Q2",
}

# PHRASE-match terms that surfaced as wasted spend or clear non-collision intent.
# Year terms not included — Q2 campaigns already negate them; legacy still leak
# `2017 range rover` etc. but year-bare PHRASE risks blocking legitimate
# "year-make-model collision repair" queries, so we let those through.
OEM_NEGATIVES_PHRASE: list[str] = [
    # Dealer / sales intent
    "dealership",
    "dealer near",
    "for sale",
    "lease",
    "lease deals",
    "buy",
    "trade in",
    "used",
    "new tesla",
    "tesla website",
    "tesla com",
    "tesla number",
    "tesla contact",
    # Parts / accessories / non-collision service
    "parts",
    "accessories",
    "tires",
    "wheels",
    "rims",
    "battery",
    "battery replacement",
    "ceramic coating",
    "windshield replacement",
    "glass repair",
    "paint kit",
    "paint repair kit",
    "alignment",
    "extended warranty",
    "service appointment",
    "service near me",
    "maintenance",
    "maintenance cost",
    "coupons",
    "recall",
    # Tesla model-only browsing
    "model 3 2023",
    "model y",
    "model s",
    "model x",
    "cybertruck body",
    "cybertruck parts",
    # Jaguar / Land Rover browsing
    "f pace maintenance",
    "vanden plas",
    "range rover dealership",
    "land rovers",
    "jaguar car",
    "jaguar repair cost",
]


def _phrase_text(t: str) -> str:
    """Google Ads stores phrase-match text as the raw text (no quotes)."""
    return t.strip().lower()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually mutate. Without this flag, runs in dry-run mode.",
    )
    args = parser.parse_args()
    dry_run = not args.execute

    client = load_client()

    print(f"\n=== Wallace OEM Negative Keyword Rollout ({len(TARGET_CAMPAIGNS)} campaigns) ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    print(f"Terms per campaign: {len(OEM_NEGATIVES_PHRASE)} (PHRASE match)")

    proposed = [
        NegativeKeyword(text=_phrase_text(t), match_type="PHRASE")
        for t in OEM_NEGATIVES_PHRASE
    ]

    existing = fetch_existing_negatives(
        client, CUSTOMER_ID, list(TARGET_CAMPAIGNS.keys())
    )

    print("\n=== Existing negative keywords (per campaign) ===")
    by_campaign: dict[int, set[tuple[str, str]]] = {}
    for s in existing:
        by_campaign.setdefault(s.campaign_id, set()).add(
            (s.keyword_text.lower(), s.match_type)
        )
    for cid, name in TARGET_CAMPAIGNS.items():
        n = len(by_campaign.get(cid, set()))
        print(f"  [{cid}] {name}: {n} existing negatives")

    print("\n=== Planned additions (skip dupes) ===")
    per_campaign_plan: dict[int, list[NegativeKeyword]] = {}
    for cid, name in TARGET_CAMPAIGNS.items():
        existing_set = by_campaign.get(cid, set())
        to_add = [
            n for n in proposed
            if (n.text, n.match_type) not in existing_set
        ]
        per_campaign_plan[cid] = to_add
        print(f"  [{cid}] {name}: +{len(to_add)} new")

    total_new = sum(len(v) for v in per_campaign_plan.values())
    print(f"\nTotal new operations: {total_new}")

    if dry_run:
        write_audit(
            op_name="wallace-oem-negatives",
            customer_id=CUSTOMER_ID,
            before=state_to_dicts(existing),
            changes={
                str(cid): negatives_to_dicts(plan)
                for cid, plan in per_campaign_plan.items()
            },
            after=None,
            dry_run=True,
        )
        print("\n[DRY RUN] No changes applied. Re-run with --execute to commit.")
        return

    results_all: dict[int, list[dict]] = {}
    for cid, plan in per_campaign_plan.items():
        if not plan:
            print(f"  [{cid}] {TARGET_CAMPAIGNS[cid]}: nothing to add")
            continue
        results = add_campaign_negatives(client, CUSTOMER_ID, cid, plan)
        results_all[cid] = results
        print(f"  [{cid}] {TARGET_CAMPAIGNS[cid]}: +{len(results)} added")

    after = fetch_existing_negatives(
        client, CUSTOMER_ID, list(TARGET_CAMPAIGNS.keys())
    )
    write_audit(
        op_name="wallace-oem-negatives",
        customer_id=CUSTOMER_ID,
        before=state_to_dicts(existing),
        changes={
            str(cid): negatives_to_dicts(plan)
            for cid, plan in per_campaign_plan.items()
        },
        after=state_to_dicts(after),
        dry_run=False,
    )
    print("\nDone. Verify via google-ads-mcp `search` on campaign_criterion next.")


if __name__ == "__main__":
    main()
