#!/usr/bin/env python3
"""Load CA vehicle fuel type registration counts by ZIP into Supabase.

Source: California Open Data Portal (CKAN API).
Dataset: Vehicle Fuel Type Count by ZIP Code.
Loads into dmv_vehicle_registrations table with source='ca_dmv'.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from supabase_migration import connect
from utils.normalize import normalize_zip
from vehicle_sources import (
    CA_CKAN_API,
    CA_DMV_KEY,
    CA_RESOURCE_IDS,
    get_vehicle_source,
)


COPY_COLUMNS = [
    "zip",
    "vehicle_count",
    "passenger_count",
    "commercial_count",
    "snapshot_date",
    "source",
    "source_dataset",
    "raw_payload",
]


def parse_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(float(str(value).strip()))
    except ValueError:
        return None


def is_numeric_zip(value: str | None) -> bool:
    if not value:
        return False
    raw = str(value).strip().split("-")[0]
    return raw.isdigit() and len(raw) <= 5


def prepare_ca_registration_record(
    row: dict[str, Any],
    *,
    snapshot_date: str,
    import_batch_id: str | None = None,
) -> dict[str, Any] | None:
    raw_zip = row.get("ZIP Code") or row.get("zip_code") or row.get("zip")
    if not is_numeric_zip(raw_zip):
        return None
    zip_code = normalize_zip(raw_zip)
    if not zip_code:
        return None

    vehicle_count = parse_int(row.get("total_vehicles"))
    if vehicle_count is None or vehicle_count <= 0:
        return None

    return {
        "zip": zip_code,
        "vehicle_count": vehicle_count,
        "passenger_count": parse_int(row.get("passenger_vehicles")),
        "commercial_count": parse_int(row.get("commercial_vehicles")),
        "snapshot_date": snapshot_date,
        "source": "ca_dmv",
        "source_dataset": row.get("_resource_id", "ca_dmv"),
        "raw_payload": json.dumps(row, sort_keys=True, default=str),
    }


def build_aggregation_sql(resource_id: str) -> str:
    v = 'CAST("Vehicles" AS numeric)'
    return (
        f'SELECT "ZIP Code",'
        f" SUM({v}) as total_vehicles,"
        f" SUM(CASE WHEN \"Duty\"='Light' THEN {v} ELSE 0 END) as passenger_vehicles,"
        f" SUM(CASE WHEN \"Duty\"='Heavy' THEN {v} ELSE 0 END) as commercial_vehicles"
        f' FROM "{resource_id}"'
        f" WHERE \"ZIP Code\" ~ '^[0-9]'"
        f' GROUP BY "ZIP Code"'
    )


def fetch_ca_vehicle_counts(
    *,
    year: int = 2024,
    resource_id: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    rid = resource_id or CA_RESOURCE_IDS.get(year)
    if not rid:
        raise ValueError(f"No resource ID for year {year}. Available: {sorted(CA_RESOURCE_IDS)}")

    sql = build_aggregation_sql(rid)
    url = f"{CA_CKAN_API}?{urlencode({'sql': sql})}"
    req = Request(url, headers={"User-Agent": "PSG-DataLake/1.0"})
    with urlopen(req, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if not payload.get("success"):
        raise RuntimeError(f"CKAN API error: {payload}")

    records = payload["result"]["records"]
    for r in records:
        r["_resource_id"] = rid

    snapshot_date = f"{year}-12-31"
    return records, snapshot_date


def load_ca_registration_rows(
    conn,
    *,
    rows: list[dict[str, Any]],
    snapshot_date: str,
) -> dict[str, int]:
    prepared = [
        record
        for record in (
            prepare_ca_registration_record(row, snapshot_date=snapshot_date)
            for row in rows
        )
        if record
    ]
    if not prepared:
        return {"rows_prepared": 0}

    conn.execute(
        "CREATE TEMP TABLE ca_dmv_stage"
        " (LIKE public.dmv_vehicle_registrations INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            f"COPY ca_dmv_stage ({', '.join(COPY_COLUMNS)}) FROM STDIN"
        ) as copy:
            for record in prepared:
                copy.write_row([record[col] for col in COPY_COLUMNS])

    conn.execute(
        f"""
        INSERT INTO public.dmv_vehicle_registrations ({', '.join(COPY_COLUMNS)})
        SELECT {', '.join(COPY_COLUMNS)}
        FROM ca_dmv_stage
        ON CONFLICT (zip, snapshot_date)
        DO UPDATE SET
          vehicle_count = EXCLUDED.vehicle_count,
          passenger_count = EXCLUDED.passenger_count,
          commercial_count = EXCLUDED.commercial_count,
          source = EXCLUDED.source,
          source_dataset = EXCLUDED.source_dataset,
          raw_payload = EXCLUDED.raw_payload,
          imported_at = NOW()
        """
    )
    return {"rows_prepared": len(prepared)}


def load_ca_registrations(
    conn,
    *,
    year: int = 2024,
    resource_id: str | None = None,
) -> dict[str, Any]:
    source = get_vehicle_source(CA_DMV_KEY)
    rows, snapshot_date = fetch_ca_vehicle_counts(year=year, resource_id=resource_id)
    result = load_ca_registration_rows(conn, rows=rows, snapshot_date=snapshot_date)
    conn.commit()
    print(
        f"{source.key} {year}: {result['rows_prepared']} ZIPs loaded (snapshot {snapshot_date})",
        file=sys.stderr,
        flush=True,
    )
    return {
        "source": asdict(source),
        "year": year,
        "snapshot_date": snapshot_date,
        "fetched_rows": len(rows),
        **result,
    }


def inspect_source_info() -> dict[str, Any]:
    source = get_vehicle_source(CA_DMV_KEY)
    return {
        "source": asdict(source),
        "resource_ids": CA_RESOURCE_IDS,
        "endpoint": CA_CKAN_API,
        "example_sql": build_aggregation_sql(CA_RESOURCE_IDS[2024]),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    subcommands.add_parser("inspect-source")

    load = subcommands.add_parser("load-ca-registrations")
    load.add_argument("--year", type=int, default=2024, choices=sorted(CA_RESOURCE_IDS))
    load.add_argument("--resource-id", default=None)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "inspect-source":
        print(json.dumps(inspect_source_info(), indent=2))
        return 0

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    with connect(args.database_url) as conn:
        if args.command == "load-ca-registrations":
            result = load_ca_registrations(
                conn,
                year=args.year,
                resource_id=args.resource_id,
            )
            print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
