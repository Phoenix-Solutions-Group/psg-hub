"""Wallace Collision Center — pause the qualify_lead page-view GTM tag.

Problem: container GTM-KF7JXTB has two tags firing the GA4 `qualify_lead`
event:

  Tag id=2 'GA4 - qualify_lead (Repair Estimate Page)'  -> Page view trigger
  Tag id=3 'GA4 - qualify_lead (Elementor dataLayer)'   -> Form submit trigger

The page-view tag fires every time anyone loads /repair-estimate/, including
ad clicks that never submit a form. That inflates qualify_lead with false
positives AND double-counts users who do submit (1 page view + 1 submit).
Smart Bidding optimizes on the inflated signal.

Fix: pause tag id=2. qualify_lead then fires only on real form submission.

Mutations:
  1. Workspace tag `paused = True` on 'GA4 - qualify_lead (Repair Estimate Page)'
  2. Create new container version with notes
  3. Publish the new version

Usage:
  python -m ops.wallace.pause_qualify_lead_pageview --dry-run
  python -m ops.wallace.pause_qualify_lead_pageview --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from gtm_psg.audit_log import write_audit
from gtm_psg.client import load_gtm_service
from gtm_psg.mutations.tags import (
    create_version_and_publish,
    find_tag,
    get_default_workspace,
    list_tags,
    resolve_container,
    set_tag_paused,
)

OP_NAME = "wallace-pause-qualify-lead-pageview"
CONTAINER_PUBLIC_ID = "GTM-KF7JXTB"
TARGET_TAG_NAME = "GA4 - qualify_lead (Repair Estimate Page)"
KEEP_TAG_NAME = "GA4 - qualify_lead (Elementor dataLayer)"
VERSION_NOTES = (
    "Pause page-view qualify_lead tag. Form-submit tag remains live. "
    "Stops false-positive lead inflation from ad clicks that bounce."
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    dry_run = args.dry_run

    print(f"\n=== Wallace GTM: Pause qualify_lead page-view tag ===")
    print(f"Container: {CONTAINER_PUBLIC_ID}")
    print(f"Mode: {'DRY RUN' if dry_run else 'EXECUTE'}")

    service = load_gtm_service()
    container = resolve_container(service, CONTAINER_PUBLIC_ID)
    print(f"  container path: {container['path']}")

    workspace = get_default_workspace(service, container["path"])
    print(f"  workspace: {workspace['name']} ({workspace['path']})")

    tags = list_tags(service, workspace["path"])
    target = find_tag(tags, TARGET_TAG_NAME)
    keep = find_tag(tags, KEEP_TAG_NAME)

    if target is None:
        print(f"\nERROR: tag {TARGET_TAG_NAME!r} not found in workspace.")
        print("Tags present:")
        for t in tags:
            print(f"  - {t.get('name')!r} (paused={t.get('paused', False)})")
        return 2

    before = {
        "target_tag": {
            "name": target["name"],
            "tagId": target.get("tagId"),
            "paused": target.get("paused", False),
            "firingTriggerId": target.get("firingTriggerId"),
            "path": target.get("path"),
        },
        "keep_tag": {
            "name": keep["name"] if keep else None,
            "paused": keep.get("paused", False) if keep else None,
        },
        "workspace_path": workspace["path"],
        "container_version_id": container.get("publicId"),
    }
    print("\n--- BEFORE ---")
    print(f"  target: {target['name']}  paused={target.get('paused', False)}")
    if keep:
        print(f"  keep:   {keep['name']}  paused={keep.get('paused', False)}")
    else:
        print(f"  keep:   (not found — form-submit tag is missing; ABORT)")
        return 3

    # Check LIVE container, not just workspace — workspace can be ahead of
    # published version if a prior run paused the tag but failed at publish.
    live_version = (
        service.accounts()
        .containers()
        .versions()
        .live(parent=container["path"])
        .execute()
    )
    live_target = next(
        (t for t in live_version.get("tag", []) if t.get("name") == TARGET_TAG_NAME),
        None,
    )
    live_paused = live_target.get("paused", False) if live_target else False
    print(f"  live version id={live_version.get('containerVersionId')} "
          f"target_paused_in_live={live_paused}")

    if target.get("paused") and live_paused:
        print("\n[skip] target already paused in workspace AND live. Nothing to do.")
        write_audit(
            op_name=OP_NAME,
            container_public_id=CONTAINER_PUBLIC_ID,
            before=before,
            changes={"noop": "already_paused_live"},
            after=None,
            dry_run=dry_run,
        )
        return 0

    plan = {
        "set_paused": {"tag_path": target["path"], "from": False, "to": True},
        "create_version": {"notes": VERSION_NOTES},
        "publish_version": True,
    }
    print("\n--- Planned changes ---")
    print(f"  set paused=true on tag id={target.get('tagId')} "
          f"name={target['name']!r}")
    print(f"  create new container version: {VERSION_NOTES!r}")
    print(f"  publish new version live")

    if dry_run:
        path = write_audit(
            op_name=OP_NAME,
            container_public_id=CONTAINER_PUBLIC_ID,
            before=before,
            changes=plan,
            after=None,
            dry_run=True,
        )
        print(f"\n[DRY RUN] No changes applied. Audit log: {path}")
        return 0

    print("\n=== Applying ===")
    updated_tag = set_tag_paused(service, target["path"], paused=True)
    print(f"  [OK] tag paused: {updated_tag['name']!r} "
          f"paused={updated_tag.get('paused')}")

    version, publish_resp = create_version_and_publish(
        service, workspace["path"], VERSION_NOTES
    )
    print(f"  [OK] version created: {version.get('name')} "
          f"({version.get('containerVersionId')})")
    print(f"  [OK] published: live version id="
          f"{publish_resp.get('containerVersion', {}).get('containerVersionId')}")

    after = {
        "target_tag": {
            "name": updated_tag["name"],
            "tagId": updated_tag.get("tagId"),
            "paused": updated_tag.get("paused"),
        },
        "published_version": {
            "containerVersionId": version.get("containerVersionId"),
            "name": version.get("name"),
            "notes": version.get("notes"),
        },
    }
    path = write_audit(
        op_name=OP_NAME,
        container_public_id=CONTAINER_PUBLIC_ID,
        before=before,
        changes={**plan, "result": {"version_id": version.get("containerVersionId")}},
        after=after,
        dry_run=False,
    )
    print(f"\nAudit log: {path}")
    print("\nDone. qualify_lead now fires only on Elementor form submit.")
    print("Allow GA4 ~24h to stabilize. Smart Bidding will see cleaner signal.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
