"""Wallace Collision Center — repoint Q2 RSA final_urls to live site pages.

Problem: 4 of 11 Q2 RSAs point at non-existent URLs.
  - 1 JLR ad on `/jaguar-land-rover-certified/` (404, DISAPPROVED)
  - 3 Toyota ads on `/toyota-certified/` (404, DISAPPROVED)

Fix: update Ad.final_urls. Ad text assets are immutable, but final_urls,
final_mobile_urls, tracking_url_template, and url_custom_parameters can be
updated on an existing ad via AdService.mutate_ads.

Live-crawl verified targets (2026-05-20):
  /jlr-certified-repair-center/ -- exists, dedicated JLR cert page
  /certifications/              -- exists, OEM hub (Toyota listed by logo)
  /start-estimate/              -- exists, conversion-intent page

No Toyota-specific cert page exists yet. Toyota cert-intent ad groups bridge
to /certifications/. Toyota conquest ad group bridges to /start-estimate/.
Once site team builds /certifications/toyota/, repoint cert-intent ad groups
to it (this script is idempotent — re-run with updated CHANGES).

Run:
  python -m ops.wallace.remap_q2_final_urls --customer-id 6048611995
  python -m ops.wallace.remap_q2_final_urls --customer-id 6048611995 --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.protobuf import field_mask_pb2

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client

OP_NAME = "wallace-remap-q2-final-urls"

# (ad_id, label, new_final_url)
CHANGES: list[tuple[int, str, str]] = [
    (
        807976610098,
        "JLRCertified_2026Q2 / JLR Certified Collision",
        "https://wallacecollisionrepair.com/jlr-certified-repair-center/",
    ),
    (
        808059274238,
        "ToyotaCertified_2026Q2 / Toyota Certified Collision",
        "https://wallacecollisionrepair.com/certifications/",
    ),
    (
        808059274499,
        "ToyotaCertified_2026Q2 / Toyota Model Specific",
        "https://wallacecollisionrepair.com/certifications/",
    ),
    (
        808059274550,
        "ToyotaCertified_2026Q2 / Toyota Dealer Conquest",
        "https://wallacecollisionrepair.com/certifications/",
    ),
]


def fetch_state(client, customer_id: str) -> list[dict]:
    ga = client.get_service("GoogleAdsService")
    ids = ", ".join(str(ad_id) for ad_id, _, _ in CHANGES)
    query = f"""
        SELECT campaign.name, ad_group.name,
               ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
               ad_group_ad.status,
               ad_group_ad.policy_summary.approval_status
        FROM ad_group_ad
        WHERE ad_group_ad.ad.id IN ({ids})
    """
    rows = []
    for row in ga.search(customer_id=customer_id, query=query):
        rows.append({
            "campaign_name": row.campaign.name,
            "ad_group_name": row.ad_group.name,
            "ad_id": row.ad_group_ad.ad.id,
            "final_urls": list(row.ad_group_ad.ad.final_urls),
            "ad_status": row.ad_group_ad.status.name,
            "approval_status": row.ad_group_ad.policy_summary.approval_status.name,
        })
    return rows


def update_ad_final_url(client, customer_id: str, ad_id: int, new_url: str):
    svc = client.get_service("AdService")
    op = client.get_type("AdOperation")
    op.update.resource_name = svc.ad_path(customer_id, ad_id)
    # Clear existing then set the single target URL.
    op.update.final_urls.append(new_url)
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["final_urls"]))
    return svc.mutate_ads(customer_id=customer_id, operations=[op])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer-id", required=True, help="Digits only, no dashes")
    parser.add_argument("--execute", action="store_true",
                        help="Actually mutate. Default is dry-run.")
    args = parser.parse_args()

    client = load_client()

    print(f"\n=== Wallace Q2 Final URL Remap ({len(CHANGES)} ads) ===")
    print(f"Mode: {'EXECUTE' if args.execute else 'DRY RUN'}")

    before = fetch_state(client, args.customer_id)
    print("\n--- BEFORE ---")
    for r in before:
        print(f"  [{r['ad_id']}] {r['campaign_name']} / {r['ad_group_name']}: "
              f"ad={r['ad_status']} approval={r['approval_status']} "
              f"final_urls={r['final_urls']}")

    print("\n--- Planned changes ---")
    plan = []
    for ad_id, label, new_url in CHANGES:
        current = next((r for r in before if r["ad_id"] == ad_id), None)
        if current is None:
            print(f"  [skip] {label} ({ad_id}): not found")
            continue
        if current["final_urls"] == [new_url]:
            print(f"  [skip] {label} ({ad_id}): already at target URL")
            continue
        plan.append({
            "ad_id": ad_id,
            "label": label,
            "from_urls": current["final_urls"],
            "to_url": new_url,
        })
        print(f"  [{ad_id}] {label}:")
        print(f"      {current['final_urls']}")
        print(f"   -> [{new_url!r}]")

    if not args.execute:
        path = write_audit(
            op_name=OP_NAME,
            customer_id=args.customer_id,
            before=before,
            changes={"plan": plan},
            after=None,
            dry_run=True,
        )
        print(f"\n[DRY RUN] No changes applied. Audit log: {path}")
        return 0

    print("\n=== Applying ===")
    results = []
    for item in plan:
        resp = update_ad_final_url(
            client, args.customer_id, item["ad_id"], item["to_url"]
        )
        rn = resp.results[0].resource_name
        results.append({"ad_id": item["ad_id"], "resource_name": rn})
        print(f"  [OK] {item['label']} ({item['ad_id']}) -> {rn}")

    after = fetch_state(client, args.customer_id)
    print("\n--- AFTER ---")
    for r in after:
        print(f"  [{r['ad_id']}] {r['campaign_name']} / {r['ad_group_name']}: "
              f"approval={r['approval_status']} final_urls={r['final_urls']}")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=args.customer_id,
        before=before,
        changes={"plan": plan, "results": results},
        after=after,
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    print("\nGoogle will re-crawl new URLs within ~1 business day. Toyota ads")
    print("expected to flip APPROVED with BELOW_AVERAGE landing-page experience")
    print("until site team ships /certifications/toyota/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
