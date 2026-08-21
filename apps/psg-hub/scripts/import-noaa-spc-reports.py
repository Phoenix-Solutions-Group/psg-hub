#!/usr/bin/env python3
"""Import current NOAA SPC preliminary tornado, hail, and wind reports."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


SOURCE_KEY = "noaa_spc_preliminary_reports"
SOURCE_URL = "https://www.spc.noaa.gov/climo/reports/"
REPORT_TYPES = {
    "torn": ("Tornado", 4.5),
    "hail": ("Hail", 5.0),
    "wind": ("Thunderstorm Wind", 4.0),
}


def load_env(path: Path) -> dict[str, str]:
    if not path.is_absolute():
        raise ValueError("--env-file must be an absolute path")
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def report_url(report_date: date, report_type: str) -> str:
    return f"{SOURCE_URL}{report_date:%y%m%d}_rpts_{report_type}.csv"


def fetch_csv(url: str) -> list[dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": "PSG weather data importer"})
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    for row in rows:
        # One SPC row currently has an extra empty location field, shifting the
        # remaining columns right. Repair that known shape without dropping it.
        if row.get("Lat", "").isalpha() and len(row["Lat"]) == 2 and row.get(None):
            row["County"], row["State"], row["Lat"], row["Lon"], row["Comments"] = (
                row.get("State", ""),
                row["Lat"],
                row.get("Lon", ""),
                row.get("Comments", ""),
                ",".join(row[None]),
            )
            del row[None]
    return rows


def report_timestamp(report_date: date, hhmm: str) -> datetime:
    value = hhmm.strip().zfill(4)
    timestamp = datetime.combine(
        report_date,
        datetime.strptime(value, "%H%M").time(),
        tzinfo=timezone.utc,
    )
    # SPC daily files cover the 12Z-to-12Z convective day.
    return timestamp + timedelta(days=1) if timestamp.hour < 12 else timestamp


def stable_id(report_date: date, report_type: str, row: dict[str, str]) -> int:
    identity = "|".join([report_date.isoformat(), report_type, json.dumps(row, sort_keys=True)])
    return int(hashlib.sha256(identity.encode()).hexdigest()[:15], 16)


def magnitude(report_type: str, row: dict[str, str]) -> float | None:
    value = row.get("Size" if report_type == "hail" else "Speed", "").strip()
    if not value or value.upper() == "UNK":
        return None
    number = float(value)
    return number / 100 if report_type == "hail" else number


def transform(report_date: date, report_type: str, row: dict[str, str], batch_id: str) -> dict[str, Any]:
    event_type, weight = REPORT_TYPES[report_type]
    timestamp = report_timestamp(report_date, row["Time"])
    payload = dict(row)
    payload.update({"report_date": report_date.isoformat(), "report_type": report_type})
    return {
        "source": SOURCE_KEY,
        "source_event_id": stable_id(report_date, report_type, row),
        "event_type": event_type,
        "event_type_normalized": event_type.lower(),
        "begin_time": timestamp.isoformat(),
        "end_time": timestamp.isoformat(),
        "state": row.get("State") or None,
        "source_year": timestamp.year,
        "source_month": timestamp.month,
        "month_name": timestamp.strftime("%B"),
        "magnitude": magnitude(report_type, row),
        "magnitude_type": "IN" if report_type == "hail" else ("MPH" if report_type == "wind" else None),
        "begin_lat": float(row["Lat"]),
        "begin_lng": float(row["Lon"]),
        "end_lat": float(row["Lat"]),
        "end_lng": float(row["Lon"]),
        "repair_demand_weight": weight,
        "import_batch_id": batch_id,
        "raw_payload": payload,
    }


def batches(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def request_json(url: str, key: str, payload: Any) -> None:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, separators=(",", ":")).encode(),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                if response.status not in {200, 201, 204}:
                    raise RuntimeError(f"Unexpected HTTP status {response.status}")
                return
        except urllib.error.HTTPError as error:
            details = error.read().decode(errors="replace")
            if attempt == 2:
                raise RuntimeError(f"HTTP {error.code}: {details}") from error
            time.sleep(2**attempt)
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def daterange(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def self_test() -> dict[str, Any]:
    sample = {
        "Time": "0230",
        "Lat": "41.1",
        "Lon": "-88.2",
        "Location": "X",
        "County": "Y",
        "State": "IL",
        "Size": "125",
    }
    report_date = date(2026, 8, 17)
    assert report_timestamp(report_date, "0230") == datetime(2026, 8, 18, 2, 30, tzinfo=timezone.utc)
    assert magnitude("hail", sample) == 1.25
    assert stable_id(report_date, "hail", sample) == stable_id(report_date, "hail", sample)
    assert transform(report_date, "hail", sample, "self-test")["source_year"] == 2026
    return {"self_test": "passed", "rows": 1}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    required = ("env_file", "project_id", "start_date", "end_date", "cycle", "batch_id")
    missing = [name.replace("_", "-") for name in required if getattr(args, name) is None]
    if missing:
        raise ValueError(f"required arguments missing: {', '.join(f'--{name}' for name in missing)}")

    env = load_env(Path(args.env_file))
    supabase_url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]
    if args.project_id not in supabase_url:
        raise ValueError("Supabase URL does not match --project-id")

    start = date.fromisoformat(args.start_date)
    end = date.fromisoformat(args.end_date)
    if end < start:
        raise ValueError("--end-date must be on or after --start-date")

    rows: list[dict[str, Any]] = []
    for report_date in daterange(start, end):
        for report_type in REPORT_TYPES:
            rows.extend(
                transform(report_date, report_type, row, args.batch_id)
                for row in fetch_csv(report_url(report_date, report_type))
            )

    events_endpoint = f"{supabase_url}/rest/v1/storm_events?on_conflict=source%2Csource_event_id"
    for chunk in batches(rows, args.batch_size):
        request_json(events_endpoint, service_key, chunk)

    source_endpoint = (
        f"{supabase_url}/rest/v1/storm_event_sources?"
        "on_conflict=source_key%2Cfile_family%2Csource_year%2Ccycle"
    )
    request_json(
        source_endpoint,
        service_key,
        {
            "source_key": SOURCE_KEY,
            "source_url": SOURCE_URL,
            "file_family": "daily_reports",
            "source_year": end.year,
            "cycle": args.cycle,
            "file_url": f"{SOURCE_URL}YYMMDD_rpts_TYPE.csv",
            "row_count": len(rows),
            "status": "loaded_provisional",
            "import_batch_id": args.batch_id,
            "notes": f"SPC preliminary tornado, hail, and wind reports for {start} through {end}.",
        },
    )
    return {"imported": len(rows), "start": str(start), "end": str(end), "batch_id": args.batch_id}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file")
    parser.add_argument("--project-id")
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--cycle")
    parser.add_argument("--batch-id")
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
