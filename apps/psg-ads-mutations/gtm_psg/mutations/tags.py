"""GTM Tag mutations: pause / resume / find."""
from __future__ import annotations

from typing import Any, Iterable

from googleapiclient.discovery import Resource


def resolve_container(service: Resource, container_public_id: str) -> dict[str, Any]:
    """Find a container by its public ID (e.g. 'GTM-KF7JXTB') across all accessible
    accounts. Returns the full container resource dict.
    """
    accounts = service.accounts().list().execute().get("account", [])
    for acct in accounts:
        acct_path = acct["path"]
        containers = (
            service.accounts()
            .containers()
            .list(parent=acct_path)
            .execute()
            .get("container", [])
        )
        for c in containers:
            if c.get("publicId") == container_public_id:
                return c
    raise RuntimeError(
        f"Container {container_public_id} not found in any accessible GTM account."
    )


def get_default_workspace(service: Resource, container_path: str) -> dict[str, Any]:
    """Return the 'Default Workspace' (the autosave workspace) for the container."""
    workspaces = (
        service.accounts()
        .containers()
        .workspaces()
        .list(parent=container_path)
        .execute()
        .get("workspace", [])
    )
    for w in workspaces:
        if w.get("name") == "Default Workspace":
            return w
    if workspaces:
        return workspaces[0]
    raise RuntimeError(f"No workspaces found under {container_path}.")


def list_tags(service: Resource, workspace_path: str) -> list[dict[str, Any]]:
    return (
        service.accounts()
        .containers()
        .workspaces()
        .tags()
        .list(parent=workspace_path)
        .execute()
        .get("tag", [])
    )


def find_tag(tags: Iterable[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for t in tags:
        if t.get("name") == name:
            return t
    return None


def set_tag_paused(
    service: Resource, tag_path: str, paused: bool
) -> dict[str, Any]:
    """Patch a tag's paused field. Returns the updated tag resource."""
    # The GTM API expects the full tag body for update; use the patch via
    # the .update() method which replaces fields supplied. We must fetch
    # current state and PUT the modified body, since tags() exposes update
    # not patch in v2.
    current = (
        service.accounts()
        .containers()
        .workspaces()
        .tags()
        .get(path=tag_path)
        .execute()
    )
    current["paused"] = paused
    return (
        service.accounts()
        .containers()
        .workspaces()
        .tags()
        .update(path=tag_path, body=current)
        .execute()
    )


def create_version_and_publish(
    service: Resource,
    workspace_path: str,
    notes: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Create a container version from the workspace, then publish it.

    Returns (version_resource, publish_response).
    """
    cv_resp = (
        service.accounts()
        .containers()
        .workspaces()
        .create_version(path=workspace_path, body={"name": notes, "notes": notes})
        .execute()
    )
    version = cv_resp.get("containerVersion") or {}
    version_path = version.get("path")
    if not version_path:
        raise RuntimeError(f"create_version returned no path: {cv_resp!r}")
    publish_resp = (
        service.accounts()
        .containers()
        .versions()
        .publish(path=version_path)
        .execute()
    )
    return version, publish_resp
