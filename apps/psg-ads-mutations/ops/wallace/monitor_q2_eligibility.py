"""Poll Q2 ad/campaign eligibility. Emit one line per state transition.

Exits when all 11 Q2 ads reach primary_status = ELIGIBLE (or after max-runtime
hours have passed). Each emitted line is a Monitor event the harness surfaces
as a notification.

Run:
  python -m ops.wallace.monitor_q2_eligibility --max-hours 18 --interval-sec 300
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.client import load_client

STATE_PATH = Path("/tmp/wallace-q2-eligibility-state.json")
CUSTOMER_ID = "6048611995"


def snapshot(client) -> dict:
    ga = client.get_service("GoogleAdsService")
    out = {"ads": {}, "campaigns": {}}
    q_ads = """
        SELECT campaign.name, ad_group.name, ad_group_ad.ad.id,
               ad_group_ad.status, ad_group_ad.primary_status,
               ad_group_ad.policy_summary.approval_status,
               ad_group_ad.policy_summary.review_status,
               metrics.impressions, metrics.clicks
        FROM ad_group_ad
        WHERE campaign.name LIKE 'GOOG_WAL_SRCH_%2026Q2%'
        AND segments.date DURING TODAY
    """
    for r in ga.search(customer_id=CUSTOMER_ID, query=q_ads):
        key = str(r.ad_group_ad.ad.id)
        out["ads"][key] = {
            "campaign": r.campaign.name[14:],
            "ad_group": r.ad_group.name,
            "status": r.ad_group_ad.status.name,
            "primary": r.ad_group_ad.primary_status.name,
            "approval": r.ad_group_ad.policy_summary.approval_status.name,
            "review": r.ad_group_ad.policy_summary.review_status.name,
            "impr_today": r.metrics.impressions,
            "clicks_today": r.metrics.clicks,
        }
    q_camp = """
        SELECT campaign.name, campaign.status, campaign.primary_status
        FROM campaign
        WHERE campaign.name LIKE 'GOOG_WAL_SRCH_%2026Q2%'
        AND campaign.status != 'REMOVED'
    """
    for r in ga.search(customer_id=CUSTOMER_ID, query=q_camp):
        out["campaigns"][r.campaign.name] = {
            "status": r.campaign.status.name,
            "primary": r.campaign.primary_status.name,
        }
    return out


def diff_and_emit(prev: dict, curr: dict) -> bool:
    """Print one line per meaningful change. Return True if all ads ELIGIBLE."""
    changed = False
    # ads
    for ad_id, c in curr["ads"].items():
        p = prev.get("ads", {}).get(ad_id, {})
        if not p:
            print(f"[NEW] ad {ad_id} {c['ad_group']}: primary={c['primary']} appr={c['approval']}", flush=True)
            changed = True
            continue
        if c["primary"] != p.get("primary"):
            print(f"[AD primary {p.get('primary')}→{c['primary']}] {ad_id} {c['ad_group']} (appr={c['approval']} review={c['review']})", flush=True)
            changed = True
        if c["approval"] != p.get("approval"):
            print(f"[AD approval {p.get('approval')}→{c['approval']}] {ad_id} {c['ad_group']}", flush=True)
            changed = True
        if int(c["impr_today"]) > int(p.get("impr_today", 0)):
            print(f"[IMPR] {c['ad_group']}: {p.get('impr_today',0)}→{c['impr_today']} impr today (clicks={c['clicks_today']})", flush=True)
            changed = True
    # campaigns
    for cname, c in curr["campaigns"].items():
        p = prev.get("campaigns", {}).get(cname, {})
        if c["primary"] != p.get("primary"):
            print(f"[CAMP primary {p.get('primary')}→{c['primary']}] {cname}", flush=True)
            changed = True

    primaries = {a["primary"] for a in curr["ads"].values()}
    all_eligible = primaries == {"ELIGIBLE"}
    return all_eligible


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-hours", type=float, default=18.0)
    parser.add_argument("--interval-sec", type=int, default=300)
    args = parser.parse_args()

    client = load_client()
    start = time.time()
    deadline = start + args.max_hours * 3600

    prev = {}
    if STATE_PATH.exists():
        try:
            prev = json.loads(STATE_PATH.read_text())
        except Exception:
            prev = {}

    print(f"[START] monitor q2 eligibility | max_hours={args.max_hours} interval_sec={args.interval_sec}", flush=True)
    while True:
        try:
            curr = snapshot(client)
        except Exception as e:
            print(f"[ERR] snapshot failed: {e}", flush=True)
            time.sleep(args.interval_sec)
            continue

        all_eligible = diff_and_emit(prev, curr)
        STATE_PATH.write_text(json.dumps(curr, indent=2, default=str))
        prev = curr

        # Summary of remaining non-eligible ads
        non_elig = [(aid, a) for aid, a in curr["ads"].items() if a["primary"] != "ELIGIBLE"]
        if non_elig:
            summary = ", ".join(f"{a['ad_group']}={a['primary']}" for _, a in non_elig)
            # only emit summary on first iteration or every 6th iteration (~30min)
            iter_idx = int((time.time() - start) / args.interval_sec)
            if iter_idx == 0 or iter_idx % 6 == 0:
                print(f"[STATUS] {len(curr['ads'])-len(non_elig)}/{len(curr['ads'])} eligible | pending: {summary}", flush=True)

        if all_eligible:
            print(f"[DONE] all {len(curr['ads'])} Q2 ads are ELIGIBLE.", flush=True)
            return 0

        if time.time() >= deadline:
            print(f"[TIMEOUT] reached max-hours={args.max_hours} with {len(non_elig)} ads still non-eligible.", flush=True)
            return 1

        time.sleep(args.interval_sec)


if __name__ == "__main__":
    sys.exit(main())
