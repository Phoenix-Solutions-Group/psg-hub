"""
Wallace Collision Center — unpause the 11 Q2 RSAs.

The 2026-05-13 launch_2026q2_swap script paused the 3 legacy campaigns and
enabled the Q2 replacement campaigns + ad groups + keywords, but left every
RSA at ad_group_ad.status = PAUSED. Result: campaigns ENABLED, 0 impressions,
account dark on collision search for 6 days.

This script sets ad_group_ad.status = ENABLED on every RSA in the 5 Q2
campaigns. The Brand_2026Q2 RSA is included even though its campaign is still
PAUSED, so it will start serving the moment enable_brand_campaign.py runs.

Targets (ad_group_ad.ad.id → campaign → ad_group):
  Local Collision 2026Q2 (23829477511):
    807942855741  Collision Repair
    807976627198  Body Shop
    807976628086  Competitor Conquest
    807976652800  Paint and Dent
    808059224855  Estimate and Insurance
  Tesla Approved 2026Q2 (23825006339):
    807976782880  Tesla Approved Collision
  JLR Certified 2026Q2 (23819664216):
    807976610098  JLR Certified Collision
  Toyota Certified 2026Q2 (23819659089):
    808059274238  Toyota Certified Collision
    808059274499  Toyota Model Specific
    808059274550  Toyota Dealer Conquest
  Brand 2026Q2 (23825006324):  -- campaign itself is PAUSED; enable separately
    807976621120  Brand Terms

Run: python -m ops.wallace.unpause_q2_ads --dry-run
     python -m ops.wallace.unpause_q2_ads --execute
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

# (ad_group_id, ad_id, label) — label used for printout only.
TARGETS: list[tuple[int, int, str]] = [
    (199150151511, 807942855741, "LocalCollision_2026Q2 / Collision Repair"),
    (196707006136, 807976627198, "LocalCollision_2026Q2 / Body Shop"),
    (199150168751, 807976628086, "LocalCollision_2026Q2 / Competitor Conquest"),
    (196985199555, 807976652800, "LocalCollision_2026Q2 / Paint and Dent"),
    (196985202675, 808059224855, "LocalCollision_2026Q2 / Estimate and Insurance"),
    (195506903479, 807976782880, "TeslaApproved_2026Q2 / Tesla Approved Collision"),
    (199839184481, 807976610098, "JLRCertified_2026Q2 / JLR Certified Collision"),
    (196985297035, 808059274238, "ToyotaCertified_2026Q2 / Toyota Certified Collision"),
    (194045132097, 808059274499, "ToyotaCertified_2026Q2 / Toyota Model Specific"),
    (199150232591, 808059274550, "ToyotaCertified_2026Q2 / Toyota Dealer Conquest"),
    (203049696184, 807976621120, "Brand_2026Q2 / Brand Terms (campaign still PAUSED)"),
]


def fetch_state(client) -> list[dict]:
    ga = client.get_service("GoogleAdsService")
    ids = ", ".join(str(a) for _, a, _ in TARGETS)
    query = f"""
        SELECT campaign.id, campaign.name, campaign.status,
               ad_group.id, ad_group.name, ad_group.status,
               ad_group_ad.ad.id, ad_group_ad.ad.type,
               ad_group_ad.ad_strength, ad_group_ad.status
        FROM ad_group_ad
        WHERE ad_group_ad.ad.id IN ({ids})
    """
    rows = []
    for row in ga.search(customer_id=CUSTOMER_ID, query=query):
        rows.append({
            "campaign_id": row.campaign.id,
            "campaign_name": row.campaign.name,
            "campaign_status": row.campaign.status.name,
            "ad_group_id": row.ad_group.id,
            "ad_group_name": row.ad_group.name,
            "ad_group_status": row.ad_group.status.name,
            "ad_id": row.ad_group_ad.ad.id,
            "ad_type": row.ad_group_ad.ad.type_.name,
            "ad_strength": row.ad_group_ad.ad_strength.name,
            "ad_status": row.ad_group_ad.status.name,
        })
    return rows


def enable_ad(client, ad_group_id: int, ad_id: int):
    svc = client.get_service("AdGroupAdService")
    op = client.get_type("AdGroupAdOperation")
    op.update.resource_name = svc.ad_group_ad_path(CUSTOMER_ID, ad_group_id, ad_id)
    op.update.status = client.enums.AdGroupAdStatusEnum.ENABLED
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["status"]))
    return svc.mutate_ad_group_ads(customer_id=CUSTOMER_ID, operations=[op])


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = args.dry_run

    client = load_client()

    print(f"\n=== Wallace Q2 RSA Unpause ({len(TARGETS)} ads) ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")

    before = fetch_state(client)
    print("\n--- BEFORE ---")
    for r in before:
        print(f"  [{r['ad_id']}] {r['campaign_name']} / {r['ad_group_name']}: "
              f"campaign={r['campaign_status']} ad_group={r['ad_group_status']} "
              f"ad={r['ad_status']} strength={r['ad_strength']}")

    print("\n--- Planned changes ---")
    plan: list[dict] = []
    for ag_id, ad_id, label in TARGETS:
        current = next((r for r in before if r["ad_id"] == ad_id), None)
        if current is None:
            print(f"  [skip] {label} ({ad_id}): not found")
            continue
        if current["ad_status"] == "ENABLED":
            print(f"  [skip] {label} ({ad_id}): already ENABLED")
            continue
        plan.append({
            "ad_group_id": ag_id,
            "ad_id": ad_id,
            "label": label,
            "from_status": current["ad_status"],
            "to_status": "ENABLED",
        })
        print(f"  [{ad_id}] {label}: {current['ad_status']} -> ENABLED")

    if dry_run:
        path = write_audit(
            op_name="wallace-unpause-q2-ads",
            customer_id=CUSTOMER_ID,
            before=before,
            changes={"plan": plan},
            after=None,
            dry_run=True,
        )
        print(f"\n[DRY RUN] No changes applied. Audit log: {path}")
        return

    print("\n=== Applying ===")
    results = []
    for item in plan:
        resp = enable_ad(client, item["ad_group_id"], item["ad_id"])
        rn = resp.results[0].resource_name
        results.append({"ad_id": item["ad_id"], "resource_name": rn})
        print(f"  [OK] {item['label']} ({item['ad_id']}) -> {rn}")

    after = fetch_state(client)
    print("\n--- AFTER ---")
    for r in after:
        print(f"  [{r['ad_id']}] {r['campaign_name']} / {r['ad_group_name']}: "
              f"ad={r['ad_status']}")

    path = write_audit(
        op_name="wallace-unpause-q2-ads",
        customer_id=CUSTOMER_ID,
        before=before,
        changes={"plan": plan, "results": results},
        after=after,
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    print("\nDone. Ads now ENABLED. Q2 campaigns serving except Brand_2026Q2,")
    print("which needs enable_brand_campaign.py to flip its campaign status.")


if __name__ == "__main__":
    main()
