#!/usr/bin/env python3
"""Import one NOAA Storm Events bulk CSV into the existing Supabase tables."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


SOURCE_KEY = "ncei_storm_events"
SOURCE_URL = "https://www.ncei.noaa.gov/stormevents/ftp.jsp"


def load_env(path: Path) -> dict[str, str]:
    if not path.is_absolute():
        raise ValueError("--env-file must be an absolute path")
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def nullable_number(value: str, cast: type[int] | type[float]) -> int | float | None:
    value = value.strip()
    return cast(value) if value else None


def parse_damage(value: str) -> float | None:
    value = value.strip().upper().replace(",", "")
    if not value:
        return None
    multipliers = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    suffix = value[-1]
    if suffix in multipliers:
        return float(value[:-1]) * multipliers[suffix]
    return float(value)


def parse_timestamp(row: dict[str, str], prefix: str) -> str | None:
    year_month = row.get(f"{prefix}_YEARMONTH", "").strip()
    day = row.get(f"{prefix}_DAY", "").strip()
    hhmm = row.get(f"{prefix}_TIME", "").strip().zfill(4)
    if not year_month or not day or not hhmm:
        return None
    naive = datetime.strptime(f"{year_month}{int(day):02d}{hhmm}", "%Y%m%d%H%M")
    match = re.search(r"([+-]\d+(?:\.\d+)?)$", row.get("CZ_TIMEZONE", ""))
    offset = timedelta(hours=float(match.group(1))) if match else timedelta(0)
    return naive.replace(tzinfo=timezone(offset)).isoformat()


def demand_weight(event_type: str) -> float:
    normalized = event_type.strip().lower()
    if normalized == "hail":
        return 5
    if normalized in {"tornado", "waterspout"}:
        return 4.5
    if normalized in {
        "thunderstorm wind",
        "marine thunderstorm wind",
        "high wind",
        "marine high wind",
        "strong wind",
    }:
        return 4
    if normalized in {"tropical storm", "tropical depression", "hurricane (typhoon)", "storm surge/tide"}:
        return 3
    if "flood" in normalized:
        return 2.5
    if normalized in {
        "winter weather",
        "winter storm",
        "heavy snow",
        "lake-effect snow",
        "blizzard",
        "ice storm",
        "sleet",
        "frost/freeze",
        "freezing fog",
        "lightning",
    }:
        return 2
    return 1


def transform(row: dict[str, str], batch_id: str) -> dict[str, Any]:
    event_type = row["EVENT_TYPE"].strip()
    begin_lat = nullable_number(row.get("BEGIN_LAT", ""), float)
    begin_lng = nullable_number(row.get("BEGIN_LON", ""), float)
    end_lat = nullable_number(row.get("END_LAT", ""), float)
    end_lng = nullable_number(row.get("END_LON", ""), float)
    return {
        "source": SOURCE_KEY,
        "source_event_id": int(row["EVENT_ID"]),
        "episode_id": nullable_number(row.get("EPISODE_ID", ""), int),
        "event_type": event_type,
        "event_type_normalized": event_type.lower(),
        "begin_time": parse_timestamp(row, "BEGIN"),
        "end_time": parse_timestamp(row, "END"),
        "state": row.get("STATE") or None,
        "state_fips": row.get("STATE_FIPS") or None,
        "source_year": nullable_number(row.get("YEAR", ""), int),
        "source_month": nullable_number(row.get("BEGIN_YEARMONTH", "")[4:6], int),
        "month_name": row.get("MONTH_NAME") or None,
        "cz_type": row.get("CZ_TYPE") or None,
        "cz_fips": row.get("CZ_FIPS") or None,
        "cz_name": row.get("CZ_NAME") or None,
        "wfo": row.get("WFO") or None,
        "magnitude": nullable_number(row.get("MAGNITUDE", ""), float),
        "magnitude_type": row.get("MAGNITUDE_TYPE") or None,
        "injuries_direct": nullable_number(row.get("INJURIES_DIRECT", ""), int),
        "injuries_indirect": nullable_number(row.get("INJURIES_INDIRECT", ""), int),
        "deaths_direct": nullable_number(row.get("DEATHS_DIRECT", ""), int),
        "deaths_indirect": nullable_number(row.get("DEATHS_INDIRECT", ""), int),
        "damage_property_usd": parse_damage(row.get("DAMAGE_PROPERTY", "")),
        "damage_crops_usd": parse_damage(row.get("DAMAGE_CROPS", "")),
        "begin_lat": begin_lat,
        "begin_lng": begin_lng,
        "end_lat": end_lat,
        "end_lng": end_lng,
        "repair_demand_weight": demand_weight(event_type),
        "import_batch_id": batch_id,
        "raw_payload": row,
    }


def batches(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def request_json(url: str, key: str, payload: Any, prefer: str) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode()
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                if response.status not in {200, 201, 204}:
                    raise RuntimeError(f"Unexpected HTTP status {response.status}")
                return
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def self_test() -> dict[str, Any]:
    sample = {
        "EVENT_ID": "1",
        "EVENT_TYPE": "Hail",
        "YEAR": "2026",
        "BEGIN_YEARMONTH": "202608",
        "DAMAGE_PROPERTY": "10.00K",
    }
    row = transform(sample, "self-test")
    assert parse_damage("10.00K") == 10_000
    assert demand_weight("Hail") == 5
    assert demand_weight("Thunderstorm Wind") == 4
    assert row["source_year"] == 2026
    return {"self_test": "passed", "rows": 1}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    required = ("input", "env_file", "project_id", "file_url", "source_year", "cycle", "batch_id")
    missing = [name.replace("_", "-") for name in required if getattr(args, name) is None]
    if missing:
        raise ValueError(f"required arguments missing: {', '.join(f'--{name}' for name in missing)}")

    input_path = Path(args.input)
    env_path = Path(args.env_file)
    if not input_path.is_absolute():
        raise ValueError("--input must be an absolute path")
    env = load_env(env_path)
    supabase_url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]
    if args.project_id not in supabase_url:
        raise ValueError("Supabase URL does not match --project-id")

    with gzip.open(input_path, "rt", newline="", encoding="utf-8-sig") as handle:
        rows = [transform(row, args.batch_id) for row in csv.DictReader(handle)]

    endpoint = f"{supabase_url}/rest/v1/storm_events?on_conflict=source%2Csource_event_id"
    for chunk in batches(rows, args.batch_size):
        request_json(endpoint, service_key, chunk, "resolution=merge-duplicates,return=minimal")

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
            "file_family": "details",
            "source_year": args.source_year,
            "cycle": args.cycle,
            "file_url": args.file_url,
            "row_count": len(rows),
            "status": "loaded_provisional",
            "import_batch_id": args.batch_id,
            "notes": "Current-year NOAA bulk data; reconcile when a newer cycle is published.",
        },
        "resolution=merge-duplicates,return=minimal",
    )
    return {"imported": len(rows), "batch_id": args.batch_id, "cycle": args.cycle}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--env-file")
    parser.add_argument("--project-id")
    parser.add_argument("--file-url")
    parser.add_argument("--source-year", type=int)
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
