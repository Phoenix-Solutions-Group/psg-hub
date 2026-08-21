#!/usr/bin/env python3
"""Read-only pre-enable check for the FileMaker collision refresh timer."""

from __future__ import annotations

import argparse
import json
import os
import pwd
import re
import shutil
import stat
import subprocess
import tempfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DATABASES = {
    "Import Flush.fmp12",
    "Import Flush2.fmp12",
    "PhoenixSolutions_Advantage_06.1.fmp12",
    "PhoenixSolutions_Survey_06.1.fmp12",
    "Web.fmp12",
}
ERROR = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+ [+-]\d{4}).*"
    r"scripting error \((\d+)\)"
)


def result(name: str, ok: bool, detail: str) -> dict[str, Any]:
    return {"name": name, "ok": ok, "detail": detail}


def systemctl_state(unit: str) -> tuple[str, str]:
    def query(action: str) -> str:
        completed = subprocess.run(
            ["systemctl", action, unit], capture_output=True, text=True, check=False
        )
        return (completed.stdout or completed.stderr).strip()

    return query("is-enabled"), query("is-active")


def path_permissions(path: Path, expected_mode: int, expected_user: str) -> dict[str, Any]:
    try:
        metadata = path.stat()
        owner = pwd.getpwuid(metadata.st_uid).pw_name
        mode = stat.S_IMODE(metadata.st_mode)
        ok = owner == expected_user and mode == expected_mode
        return result(
            path.name,
            ok,
            f"owner={owner}, mode={mode:04o}; expected {expected_user}:{expected_mode:04o}",
        )
    except (FileNotFoundError, KeyError) as error:
        return result(path.name, False, str(error))


def latest_backup(
    root: Path, prefix: str, now: datetime, max_age: timedelta
) -> dict[str, Any]:
    matches = sorted(
        (path for path in root.glob(f"{prefix}_*") if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not matches:
        return result(f"backup_{prefix.lower()}", False, "no backup found")
    latest = matches[0]
    created = datetime.fromtimestamp(latest.stat().st_mtime, now.tzinfo)
    files = {path.name: path.stat().st_size for path in latest.rglob("*.fmp12")}
    missing = sorted(DATABASES - files.keys())
    empty = sorted(name for name, size in files.items() if size == 0)
    age = now - created
    ok = timedelta(0) <= age <= max_age and not missing and not empty
    detail = f"{latest.name}, age={age.total_seconds() / 3600:.1f}h, files={len(files)}"
    if missing:
        detail += f", missing={','.join(missing)}"
    if empty:
        detail += f", empty={','.join(empty)}"
    return result(f"backup_{prefix.lower()}", ok, detail)


def script_errors(path: Path, since: datetime) -> Counter[str]:
    counts: Counter[str] = Counter()
    try:
        for line in path.read_text(errors="replace").splitlines():
            match = ERROR.search(line)
            if not match:
                continue
            observed = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S.%f %z")
            if observed >= since:
                counts[match.group(2)] += 1
    except FileNotFoundError:
        counts["log_missing"] += 1
    return counts


def evidence(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    try:
        value = json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError) as error:
        return {"_error": str(error)}
    return value if isinstance(value, dict) else {"_error": "evidence must be an object"}


def restore_is_current(value: dict[str, Any], now: datetime) -> bool:
    if value.get("restore_drill_result") != "pass":
        return False
    try:
        tested = datetime.fromisoformat(str(value["restore_drill_at"]))
        if tested.tzinfo is None:
            return False
    except (KeyError, TypeError, ValueError):
        return False
    return timedelta(0) <= now - tested.astimezone(now.tzinfo) <= timedelta(days=90)


def collect(
    args: argparse.Namespace,
    *,
    now: datetime | None = None,
    timer: tuple[str, str] | None = None,
    disk: tuple[int, int, int] | None = None,
) -> dict[str, Any]:
    now = now or datetime.now().astimezone()
    gates = evidence(args.evidence_file)
    enabled, active = timer or systemctl_state(args.timer_unit)
    total, used, free = disk or shutil.disk_usage(args.backup_root)
    used_percent = used / total * 100
    error_counts = script_errors(args.event_log, now - timedelta(hours=args.log_hours))
    errors_ok = not error_counts or (
        "log_missing" not in error_counts and bool(gates.get("script_error_decision"))
    )
    capacity_ok = used_percent <= args.max_used_percent and free >= args.min_free_gb * 2**30
    checks = [
        result(
            "timer_disabled",
            enabled == "disabled" and active == "inactive",
            f"enabled={enabled}, active={active}",
        ),
        path_permissions(args.secret_file, 0o600, args.expected_user),
        path_permissions(args.runtime_dir, 0o700, args.expected_user),
        latest_backup(args.backup_root, "FMS", now, timedelta(hours=args.backup_hours)),
        latest_backup(args.backup_root, "Backup", now, timedelta(hours=args.backup_hours)),
        result(
            "backup_in_progress",
            not any(path.is_dir() for path in args.backup_root.rglob("*_InProgress")),
            "no incomplete backup directories found",
        ),
        result(
            "backup_capacity",
            capacity_ok,
            f"used={used_percent:.1f}%, free={free / 2**30:.1f} GiB",
        ),
        result(
            "backup_schedule_decision",
            bool(gates.get("backup_schedule_decision")),
            "recorded" if gates.get("backup_schedule_decision") else "missing",
        ),
        result(
            "nightly_script_errors",
            errors_ok,
            json.dumps(dict(sorted(error_counts.items())))
            + ("; disposition recorded" if error_counts and errors_ok else ""),
        ),
        result(
            "restore_drill",
            restore_is_current(gates, now),
            "passing evidence within 90 days" if restore_is_current(gates, now) else "missing or stale",
        ),
        result(
            "failure_owner",
            bool(gates.get("failure_owner")),
            "recorded" if gates.get("failure_owner") else "missing",
        ),
    ]
    return {"ready": all(check["ok"] for check in checks), "checks": checks}


def self_check() -> None:
    now = datetime(2026, 8, 20, 12, tzinfo=timezone.utc)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        backups = root / "backups"
        backups.mkdir()
        for prefix in ("FMS", "Backup"):
            backup = backups / f"{prefix}_2026-08-20_0000"
            destination = backup / "Databases"
            destination.mkdir(parents=True)
            for name in DATABASES:
                (destination / name).write_bytes(b"ok")
            os.utime(backup, (now.timestamp(), now.timestamp()))
        event_log = root / "Event.log"
        event_log.write_text(
            "2026-08-20 01:00:00.000 -0000 Information scripting error (101)\n"
        )
        secret = root / "secret.env"
        secret.touch(mode=0o600)
        runtime = root / "runtime"
        runtime.mkdir(mode=0o700)
        evidence_file = root / "evidence.json"
        args = argparse.Namespace(
            backup_root=backups,
            event_log=event_log,
            secret_file=secret,
            runtime_dir=runtime,
            expected_user=pwd.getpwuid(os.getuid()).pw_name,
            timer_unit="unused",
            evidence_file=evidence_file,
            log_hours=30,
            backup_hours=30,
            max_used_percent=85,
            min_free_gb=20,
        )
        evidence_file.write_text("{}")
        healthy_disk = (100 * 2**30, 50 * 2**30, 50 * 2**30)
        assert not collect(
            args, now=now, timer=("disabled", "inactive"), disk=healthy_disk
        )["ready"]
        evidence_file.write_text(
            json.dumps(
                {
                    "backup_schedule_decision": "approved",
                    "script_error_decision": "approved",
                    "restore_drill_result": "pass",
                    "restore_drill_at": now.isoformat(),
                    "failure_owner": "operations",
                }
            )
        )
        assert collect(
            args, now=now, timer=("disabled", "inactive"), disk=healthy_disk
        )["ready"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--backup-root",
        type=Path,
        default=Path("/opt/FileMaker/FileMaker Server/Data/Backups"),
    )
    parser.add_argument(
        "--event-log",
        type=Path,
        default=Path("/opt/FileMaker/FileMaker Server/Logs/Event.log"),
    )
    parser.add_argument(
        "--secret-file", type=Path, default=Path("/opt/psg/secrets/collision-refresh.env")
    )
    parser.add_argument("--runtime-dir", type=Path, default=Path("/opt/psg/runtime"))
    parser.add_argument("--evidence-file", type=Path)
    parser.add_argument("--expected-user", default="psg-refresh")
    parser.add_argument("--timer-unit", default="psg-collision-refresh.timer")
    parser.add_argument("--backup-hours", type=float, default=30)
    parser.add_argument("--log-hours", type=float, default=30)
    parser.add_argument("--max-used-percent", type=float, default=85)
    parser.add_argument("--min-free-gb", type=float, default=20)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        self_check()
        print("FileMaker refresh readiness self-check passed")
        return 0
    report = collect(args)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print("READY" if report["ready"] else "NOT READY")
        for check in report["checks"]:
            print(f"{'PASS' if check['ok'] else 'FAIL'} {check['name']}: {check['detail']}")
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
