#!/usr/bin/env python3
"""Import PII-minimized KDOT crash facts and refresh ZIP-month rollups."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DATASET_KEY = "ksdot_accidents"
SOURCE_URL = (
    "https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/"
    "Transportation/Accidents/MapServer/0"
)
QUERY_URL = f"{SOURCE_URL}/query"
SOURCE_NOTES = (
    "PII-minimized import; report images, reporting agencies, driver ages, "
    "and free-text narratives are excluded."
)
OUT_FIELDS = (
    "OBJECTID,ACCIDENT_KEY,DOT_LATITUDE,DOT_LONGITUDE,ACC_COUNTY,ACC_CITY,"
    "DATE_OF_ACCIDENT,ACC_HOUR,ACC_DAY_OF_WEEK,ACC_MONTH_NUMBER,ACC_YEAR,"
    "ACC_SEVERITY,CWOV_FHE_ACC_TYPE,WORK_ZONE_ACCS,SPEED_RELATED_ACCS,"
    "DEER_ACCS,SNOW_ICE_ACCS,RAIN_WET_ROAD_ACCS,TRAFFIC_UNITS,FATALITIES,"
    "DISABLING_INJURIES,NON_INCAPACITATING_INJURIES,POSSIBLE_INJURIES,"
    "VEHICLES,ACCIDENT_CLASS_MHE_DESC,ACCIDENT_CLASS_FHE_DESC,"
    "LIGHT_CONDITIONS_DESC,WEATHER_CONDITIONS_DESC"
)


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


def text(value: Any) -> str | None:
    result = str(value).strip() if value is not None else ""
    return result or None


def integer(value: Any, low: int = 0, high: int | None = None) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    if result < low or (high is not None and result > high):
        return None
    return result


def number(value: Any, low: float, high: float) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if low <= result <= high else None


def flag(value: Any) -> bool:
    return (integer(value) or 0) > 0


def source_date(value: Any) -> str:
    if not isinstance(value, (int, float)):
        raise ValueError(f"Invalid KDOT accident date: {value!r}")
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()


def transform(attributes: dict[str, Any], sync_id: str, refreshed_at: str) -> dict[str, Any]:
    accident_key = text(attributes.get("ACCIDENT_KEY"))
    if not accident_key:
        raise ValueError("KDOT row is missing ACCIDENT_KEY")
    collision_type = text(attributes.get("CWOV_FHE_ACC_TYPE")) or text(
        attributes.get("ACCIDENT_CLASS_FHE_DESC")
    )
    return {
        "dataset_key": DATASET_KEY,
        "accident_key": accident_key,
        "source_object_id": integer(attributes.get("OBJECTID")),
        "occurred_on": source_date(attributes.get("DATE_OF_ACCIDENT")),
        "source_year": integer(attributes.get("ACC_YEAR"), 2000, 2100),
        "month": integer(attributes.get("ACC_MONTH_NUMBER"), 1, 12),
        "hour": integer(attributes.get("ACC_HOUR"), 0, 23),
        "day_of_week": text(attributes.get("ACC_DAY_OF_WEEK")),
        "county": text(attributes.get("ACC_COUNTY")),
        "city": text(attributes.get("ACC_CITY")),
        "severity": text(attributes.get("ACC_SEVERITY")),
        "collision_type": collision_type,
        "harmful_event": text(attributes.get("ACCIDENT_CLASS_MHE_DESC")),
        "weather_condition": text(attributes.get("WEATHER_CONDITIONS_DESC")),
        "light_condition": text(attributes.get("LIGHT_CONDITIONS_DESC")),
        "rain_or_wet_road": flag(attributes.get("RAIN_WET_ROAD_ACCS")),
        "snow_or_ice": flag(attributes.get("SNOW_ICE_ACCS")),
        "deer_involved": flag(attributes.get("DEER_ACCS")),
        "speed_related": flag(attributes.get("SPEED_RELATED_ACCS")),
        "work_zone": flag(attributes.get("WORK_ZONE_ACCS")),
        "traffic_units": integer(attributes.get("TRAFFIC_UNITS")),
        "vehicle_count": integer(attributes.get("VEHICLES")),
        "fatalities": integer(attributes.get("FATALITIES")),
        "disabling_injuries": integer(attributes.get("DISABLING_INJURIES")),
        "non_incapacitating_injuries": integer(
            attributes.get("NON_INCAPACITATING_INJURIES")
        ),
        "possible_injuries": integer(attributes.get("POSSIBLE_INJURIES")),
        "latitude": number(attributes.get("DOT_LATITUDE"), -90, 90),
        "longitude": number(attributes.get("DOT_LONGITUDE"), -180, 180),
        "zip_resolution_status": "pending",
        "last_seen_sync_id": sync_id,
        "refreshed_at": refreshed_at,
    }


def chunks(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def fetch_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{url}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "PSG collision intelligence importer"},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                payload = json.loads(response.read())
            if payload.get("error"):
                raise RuntimeError(f"KDOT ArcGIS error: {payload['error']}")
            return payload
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


def source_count(year: int) -> int:
    payload = fetch_json(
        QUERY_URL,
        {
            "f": "json",
            "where": f"ACC_YEAR = '{year}'",
            "returnCountOnly": "true",
        },
    )
    return int(payload["count"])


def source_page(year: int, offset: int, page_size: int) -> list[dict[str, Any]]:
    payload = fetch_json(
        QUERY_URL,
        {
            "f": "json",
            "where": f"ACC_YEAR = '{year}'",
            "outFields": OUT_FIELDS,
            "returnGeometry": "false",
            "orderByFields": "OBJECTID ASC",
            "resultOffset": offset,
            "resultRecordCount": page_size,
        },
    )
    return [feature["attributes"] for feature in payload.get("features", [])]


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def request(
        self,
        path: str,
        payload: Any | None = None,
        method: str = "POST",
        prefer: str = "resolution=merge-duplicates,return=minimal",
    ) -> Any:
        headers = {**self.headers, "Prefer": prefer}
        request = urllib.request.Request(
            f"{self.base}/{path}",
            data=(
                json.dumps(payload, separators=(",", ":")).encode()
                if payload is not None
                else None
            ),
            headers=headers,
            method=method,
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    body = response.read()
                return json.loads(body) if body else None
            except urllib.error.HTTPError as error:
                details = error.read().decode(errors="replace")
                if error.code not in {429, 502, 503, 504}:
                    raise RuntimeError(f"Supabase HTTP {error.code}: {details}") from error
                if attempt == 3:
                    raise RuntimeError(f"Supabase HTTP {error.code}: {details}") from error
                time.sleep(2**attempt)
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2**attempt)
        raise AssertionError("unreachable")

    def upsert(self, table: str, rows: Any, conflict: str) -> None:
        self.request(
            f"{table}?{urllib.parse.urlencode({'on_conflict': conflict})}",
            rows,
        )

    def delete_stale(self, start_year: int, end_year: int, sync_id: str) -> None:
        filters = (
            f"dataset_key=eq.{DATASET_KEY}&source_year=gte.{start_year}"
            f"&source_year=lte.{end_year}&last_seen_sync_id=neq.{sync_id}"
        )
        self.request(f"ksdot_crashes?{filters}", method="DELETE", prefer="return=minimal")

    def update_source(self, values: dict[str, Any]) -> None:
        self.request(
            f"ksdot_crash_sources?dataset_key=eq.{DATASET_KEY}",
            values,
            method="PATCH",
            prefer="return=minimal",
        )


def import_year(
    client: Supabase,
    year: int,
    sync_id: str,
    refreshed_at: str,
    page_size: int,
    batch_size: int,
    workers: int,
) -> tuple[int, int]:
    expected = source_count(year)
    imported = 0
    pending = set()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for offset in range(0, expected, page_size):
            page = source_page(year, offset, page_size)
            if not page:
                raise RuntimeError(f"KDOT {year} pagination stopped at offset {offset}")
            transformed = [transform(row, sync_id, refreshed_at) for row in page]
            for batch in chunks(transformed, batch_size):
                pending.add(
                    pool.submit(
                        client.upsert,
                        "ksdot_crashes",
                        batch,
                        "dataset_key,accident_key",
                    )
                )
                if len(pending) >= workers * 2:
                    done, pending = wait(pending, return_when=FIRST_COMPLETED)
                    for future in done:
                        future.result()
            imported += len(transformed)
            print(json.dumps({"year": year, "fetched": imported, "expected": expected}), flush=True)
        for future in pending:
            future.result()
    if imported != expected:
        raise RuntimeError(f"KDOT {year} count changed during import: {imported} != {expected}")
    return expected, imported


def self_test() -> dict[str, str]:
    sample = {
        "OBJECTID": 1,
        "ACCIDENT_KEY": "20250009684",
        "DATE_OF_ACCIDENT": 1747630800000,
        "ACC_YEAR": "2025",
        "ACC_MONTH_NUMBER": 5,
        "ACC_HOUR": "16",
        "ACC_SEVERITY": "INJURY",
        "RAIN_WET_ROAD_ACCS": 1,
        "SNOW_ICE_ACCS": 0,
        "DOT_LATITUDE": 38.85,
        "DOT_LONGITUDE": -94.76,
    }
    row = transform(sample, "00000000-0000-0000-0000-000000000001", "2026-08-18T00:00:00+00:00")
    assert row["occurred_on"] == "2025-05-19"
    assert row["source_year"] == 2025
    assert row["rain_or_wet_road"] is True
    assert row["snow_or_ice"] is False
    assert row["zip_resolution_status"] == "pending"
    assert row["hour"] == 16
    assert integer("99", 0, 23) is None
    return {"self_test": "passed"}


def resolve_and_rollup(client: Supabase, batch_size: int) -> dict[str, Any]:
    processed = matched = unmatched = 0
    while True:
        batch = client.request(
            "rpc/resolve_ksdot_crash_zips",
            {"p_batch_size": batch_size},
        )
        batch_processed = int(batch["processed_rows"])
        processed += batch_processed
        matched += int(batch["matched_rows"])
        unmatched += int(batch["unmatched_rows"])
        if batch_processed == 0:
            break
        print(
            json.dumps(
                {
                    "zip_resolved": processed,
                    "zip_matched": matched,
                    "zip_unmatched": unmatched,
                }
            ),
            flush=True,
        )
    rollup = client.request("rpc/refresh_ksdot_crash_rollups", {})
    return {**rollup, "resolved_this_run": processed}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    if not args.env_file:
        raise ValueError("--env-file is required unless --self-test is used")
    if args.end_year < args.start_year:
        raise ValueError("--end-year must be on or after --start-year")
    if not 2000 <= args.start_year <= args.end_year <= 2100:
        raise ValueError("Import years must be between 2000 and 2100")
    if not 1 <= args.page_size <= 25_000:
        raise ValueError("--page-size must be between 1 and 25000")
    if args.batch_size < 1 or args.workers < 1:
        raise ValueError("--batch-size and --workers must be positive")
    if not 1 <= args.zip_batch_size <= 10_000:
        raise ValueError("--zip-batch-size must be between 1 and 10000")

    env = load_env(Path(args.env_file))
    supabase_url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]
    if args.project_id not in supabase_url:
        raise ValueError("Supabase URL does not match --project-id")

    client = Supabase(supabase_url, service_key)
    if args.resume_rollup:
        rollup = resolve_and_rollup(client, args.zip_batch_size)
        client.update_source(
            {
                "source_row_count": int(rollup["total_rows"]),
                "imported_row_count": int(rollup["total_rows"]),
                "located_row_count": int(rollup["located_rows"]),
                "zip_matched_row_count": int(rollup["zip_matched_rows"]),
                "last_sync_status": "loaded",
                "imported_at": datetime.now(timezone.utc).isoformat(),
                "notes": SOURCE_NOTES,
            }
        )
        return {"dataset_key": DATASET_KEY, "resumed": True, "rollup": rollup}

    sync_id = str(uuid.UUID(args.sync_id)) if args.sync_id else str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    source = {
        "dataset_key": DATASET_KEY,
        "source_url": SOURCE_URL,
        "attribution": "Bureau of Transportation Planning, Kansas Department of Transportation",
        "analysis_scope": "Statewide police-reported Kansas crashes; PSG import years only",
        "min_source_year": args.start_year,
        "max_source_year": args.end_year,
        "last_sync_id": sync_id,
        "last_sync_status": "running",
        "sync_started_at": started_at,
        "notes": SOURCE_NOTES,
    }
    client.upsert("ksdot_crash_sources", source, "dataset_key")

    source_rows = imported_rows = 0
    try:
        for year in range(args.start_year, args.end_year + 1):
            expected, imported = import_year(
                client,
                year,
                sync_id,
                started_at,
                args.page_size,
                args.batch_size,
                args.workers,
            )
            source_rows += expected
            imported_rows += imported
        client.delete_stale(args.start_year, args.end_year, sync_id)
        rollup = resolve_and_rollup(client, args.zip_batch_size)
        source.update(
            {
                "source_row_count": source_rows,
                "imported_row_count": imported_rows,
                "located_row_count": int(rollup["located_rows"]),
                "zip_matched_row_count": int(rollup["zip_matched_rows"]),
                "last_sync_status": "loaded",
                "imported_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        client.upsert("ksdot_crash_sources", source, "dataset_key")
    except Exception:
        source["last_sync_status"] = "failed"
        source["notes"] += " Import failed before a complete rollup refresh."
        try:
            client.upsert("ksdot_crash_sources", source, "dataset_key")
        except Exception:
            pass
        raise

    return {
        "dataset_key": DATASET_KEY,
        "sync_id": sync_id,
        "source_rows": source_rows,
        "imported_rows": imported_rows,
        "rollup": rollup,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file")
    parser.add_argument("--project-id", default="gylkkzmcmbdftxieyabw")
    parser.add_argument("--start-year", type=int, default=2019)
    parser.add_argument("--end-year", type=int, default=datetime.now().year)
    parser.add_argument("--sync-id")
    parser.add_argument("--page-size", type=int, default=5000)
    parser.add_argument("--batch-size", type=int, default=750)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--zip-batch-size", type=int, default=5000)
    parser.add_argument("--resume-rollup", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
