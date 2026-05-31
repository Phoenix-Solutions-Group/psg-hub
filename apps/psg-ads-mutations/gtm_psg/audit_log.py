"""Audit log for GTM mutations. Writes JSON per run to logs/."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"


def write_audit(
    op_name: str,
    container_public_id: str,
    before: Any,
    changes: Any,
    after: Any,
    dry_run: bool,
) -> Path:
    """Write a JSON audit record. Returns path to the written file."""
    _LOGS_DIR.mkdir(exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    mode = "dryrun" if dry_run else "execute"
    path = _LOGS_DIR / f"{op_name}-{container_public_id}-{mode}-{ts}.json"
    record = {
        "op": op_name,
        "container_public_id": container_public_id,
        "timestamp_utc": ts,
        "mode": mode,
        "before": before,
        "requested_changes": changes,
        "after": after,
    }
    path.write_text(json.dumps(record, indent=2, default=str))
    return path
