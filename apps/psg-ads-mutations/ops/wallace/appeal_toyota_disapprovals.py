"""Submit policy violation exemption requests on the 3 disapproved Toyota Q2 ads.

Disapproval reason: policy topic = DESTINATION_NOT_WORKING, type = PROHIBITED.
Google's policy bot flags Toyota ad claims as not substantiated by current
landing page (no Toyota-specific cert page exists on wallacecollisionrepair.com
as of 2026-05-20).

This script attempts the API exemption path:
  AdGroupAdOperation.policy_validation_parameter.ignorable_policy_topics
    = ["DESTINATION_NOT_WORKING"]

Caveat: PROHIBITED-type topics are typically not exemptable via API.
Expected outcome:
  - Either Google accepts and ad flips APPROVED (rare for PROHIBITED)
  - Or API returns POLICY_FINDING_ERROR / similar, and we must appeal in UI

Run:
  python -m ops.wallace.appeal_toyota_disapprovals --dry-run
  python -m ops.wallace.appeal_toyota_disapprovals --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.protobuf import field_mask_pb2

from googleads_psg.audit_log import write_audit
from googleads_psg.client import load_client

OP_NAME = "wallace-appeal-disapprovals"
CUSTOMER_ID = "6048611995"

# (ad_group_id, ad_id, label)
TARGETS: list[tuple[int, int, str]] = [
    (196985297035, 808059274238, "ToyotaCertified_2026Q2 / Toyota Certified Collision"),
    (194045132097, 808059274499, "ToyotaCertified_2026Q2 / Toyota Model Specific"),
    (199150232591, 808059274550, "ToyotaCertified_2026Q2 / Toyota Dealer Conquest"),
    (199839184481, 807976610098, "JLRCertified_2026Q2 / JLR Certified Collision"),
]

IGNORABLE_TOPICS = ["DESTINATION_NOT_WORKING"]


def fetch_state(client) -> list[dict]:
    ga = client.get_service("GoogleAdsService")
    ids = ", ".join(str(a) for _, a, _ in TARGETS)
    q = f"""
        SELECT ad_group_ad.ad.id, ad_group_ad.status,
               ad_group_ad.policy_summary.approval_status,
               ad_group_ad.policy_summary.review_status
        FROM ad_group_ad
        WHERE ad_group_ad.ad.id IN ({ids})
    """
    rows = []
    for r in ga.search(customer_id=CUSTOMER_ID, query=q):
        rows.append({
            "ad_id": r.ad_group_ad.ad.id,
            "status": r.ad_group_ad.status.name,
            "approval": r.ad_group_ad.policy_summary.approval_status.name,
            "review": r.ad_group_ad.policy_summary.review_status.name,
        })
    return rows


def submit_exemption(client, ad_group_id: int, ad_id: int):
    svc = client.get_service("AdGroupAdService")
    op = client.get_type("AdGroupAdOperation")
    op.update.resource_name = svc.ad_group_ad_path(CUSTOMER_ID, ad_group_id, ad_id)
    # Mutate the status field (set to ENABLED, no-op functionally since already
    # ENABLED) just to trigger an update operation. The policy exemption is
    # carried on the operation itself.
    op.update.status = client.enums.AdGroupAdStatusEnum.ENABLED
    op.update_mask.CopyFrom(field_mask_pb2.FieldMask(paths=["status"]))
    for topic in IGNORABLE_TOPICS:
        op.policy_validation_parameter.ignorable_policy_topics.append(topic)
    return svc.mutate_ad_group_ads(customer_id=CUSTOMER_ID, operations=[op])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = args.dry_run

    client = load_client()

    print(f"\n=== Wallace Toyota policy exemption request ({len(TARGETS)} ads) ===")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")
    print(f"Ignorable topics: {IGNORABLE_TOPICS}")

    before = fetch_state(client)
    print("\n--- BEFORE ---")
    for r in before:
        print(f"  [{r['ad_id']}] status={r['status']} appr={r['approval']} rev={r['review']}")

    if dry_run:
        path = write_audit(
            op_name=OP_NAME,
            customer_id=CUSTOMER_ID,
            before=before,
            changes={
                "ignorable_topics": IGNORABLE_TOPICS,
                "targets": [{"ad_group_id": ag, "ad_id": ad, "label": l} for ag, ad, l in TARGETS],
            },
            after=None,
            dry_run=True,
        )
        print(f"\n[DRY RUN] No changes applied. Audit log: {path}")
        return 0

    print("\n=== Submitting exemption requests ===")
    results: list[dict] = []
    failures: list[dict] = []
    for ag_id, ad_id, label in TARGETS:
        try:
            resp = submit_exemption(client, ag_id, ad_id)
            rn = resp.results[0].resource_name
            results.append({"ad_id": ad_id, "resource_name": rn})
            print(f"  [OK]   {label} ({ad_id}) -> exemption accepted")
        except Exception as e:
            failures.append({"ad_id": ad_id, "error": str(e)[:600]})
            print(f"  [FAIL] {label} ({ad_id}): {type(e).__name__}: {str(e)[:200]}")

    after = fetch_state(client)
    print("\n--- AFTER ---")
    for r in after:
        print(f"  [{r['ad_id']}] status={r['status']} appr={r['approval']} rev={r['review']}")

    path = write_audit(
        op_name=OP_NAME,
        customer_id=CUSTOMER_ID,
        before=before,
        changes={
            "ignorable_topics": IGNORABLE_TOPICS,
            "results": results,
            "failures": failures,
        },
        after=after,
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    if failures:
        print(f"\n{len(failures)} exemption(s) rejected by API.")
        print("Fallback: appeal each disapproved ad manually in Google Ads UI:")
        print("  1. Wallace account -> Ads tab -> filter Status=Not eligible")
        print("  2. Click 3-dot menu on each Toyota ad -> Appeal")
        print("  3. Select 'I fixed the issue' or 'Disagree with decision'")
        print("  4. Submit. Human review: 5-7 days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
