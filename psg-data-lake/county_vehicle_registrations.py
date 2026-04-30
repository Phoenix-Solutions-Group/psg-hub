#!/usr/bin/env python3
"""Load county-level vehicle registration counts from state open data portals.

Sources:
  TX: data.texas.gov (Socrata) - j5fk-64au
  MD: opendata.maryland.gov (Socrata) - db8v-9ewn
  WA: data.wa.gov (Socrata) - hmzg-s6q4

Loads into county_vehicle_registrations table.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from supabase_migration import connect


@dataclass(frozen=True)
class CountyVehicleSource:
    key: str
    name: str
    state: str
    endpoint: str
    dataset_id: str
    cadence: str
    license_note: str


COUNTY_SOURCES: dict[str, CountyVehicleSource] = {
    "tx_dmv": CountyVehicleSource(
        key="tx_dmv",
        name="Texas DMV Registered Vehicles by County",
        state="TX",
        endpoint="https://data.texas.gov/resource/j5fk-64au.json",
        dataset_id="j5fk-64au",
        cadence="monthly",
        license_note="Texas Open Data.",
    ),
    "md_mva": CountyVehicleSource(
        key="md_mva",
        name="Maryland MVA Vehicle Registrations by County",
        state="MD",
        endpoint="https://opendata.maryland.gov/resource/db8v-9ewn.json",
        dataset_id="db8v-9ewn",
        cadence="monthly",
        license_note="Maryland Open Data.",
    ),
    "wa_dol": CountyVehicleSource(
        key="wa_dol",
        name="Washington DOL Vehicle Registrations by Class and County",
        state="WA",
        endpoint="https://data.wa.gov/resource/hmzg-s6q4.json",
        dataset_id="hmzg-s6q4",
        cadence="quarterly",
        license_note="Washington Open Data.",
    ),
}

COPY_COLUMNS = [
    "county_name",
    "state",
    "vehicle_count",
    "snapshot_date",
    "source",
    "source_dataset",
    "raw_payload",
    "import_batch_id",
]


def parse_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(float(str(value).strip().replace(",", "")))
    except ValueError:
        return None


def _fetch_socrata_all(endpoint: str, *, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Fetch all rows from Socrata API with pagination."""
    limit = 50000
    offset = 0
    all_rows: list[dict[str, Any]] = []
    base_params = params or {}

    while True:
        query_params = {**base_params, "$limit": str(limit), "$offset": str(offset)}
        url = f"{endpoint}?{urlencode(query_params)}"
        req = Request(url, headers={"User-Agent": "PSG-DataLake/1.0"})
        with urlopen(req, timeout=120) as response:
            batch = json.loads(response.read().decode("utf-8"))
        if not batch:
            break
        all_rows.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return all_rows


def _prepare_tx_row(row: dict[str, Any], *, import_batch_id: str) -> dict[str, Any] | None:
    county = str(row.get("county", "")).strip()
    if not county:
        return None
    count = parse_int(row.get("count") or row.get("registration_count"))
    if count is None or count <= 0:
        return None
    date_val = str(row.get("date") or row.get("month") or "").strip()
    snapshot = date_val[:10] if len(date_val) >= 10 else date_val or None
    return {
        "county_name": county,
        "state": "TX",
        "vehicle_count": count,
        "snapshot_date": snapshot,
        "source": "tx_dmv",
        "source_dataset": "j5fk-64au",
        "raw_payload": json.dumps(row, sort_keys=True, default=str),
        "import_batch_id": import_batch_id,
    }


def _prepare_md_row(row: dict[str, Any], *, import_batch_id: str) -> dict[str, Any] | None:
    county = str(row.get("county", "")).strip()
    if not county:
        return None
    count = parse_int(row.get("vehicle_count") or row.get("total") or row.get("count"))
    if count is None or count <= 0:
        return None
    date_val = str(row.get("year_month") or row.get("date") or "").strip()
    snapshot = date_val[:10] if len(date_val) >= 10 else date_val or None
    return {
        "county_name": county,
        "state": "MD",
        "vehicle_count": count,
        "snapshot_date": snapshot,
        "source": "md_mva",
        "source_dataset": "db8v-9ewn",
        "raw_payload": json.dumps(row, sort_keys=True, default=str),
        "import_batch_id": import_batch_id,
    }


def _prepare_wa_row(row: dict[str, Any], *, import_batch_id: str) -> dict[str, Any] | None:
    county = str(row.get("county", "")).strip()
    if not county:
        return None
    count = parse_int(row.get("transaction_count") or row.get("count"))
    if count is None or count <= 0:
        return None
    date_val = str(row.get("date") or row.get("registration_date") or "").strip()
    snapshot = date_val[:10] if len(date_val) >= 10 else date_val or None
    return {
        "county_name": county,
        "state": "WA",
        "vehicle_count": count,
        "snapshot_date": snapshot,
        "source": "wa_dol",
        "source_dataset": "hmzg-s6q4",
        "raw_payload": json.dumps(row, sort_keys=True, default=str),
        "import_batch_id": import_batch_id,
    }


PREPARE_FNS = {
    "tx_dmv": _prepare_tx_row,
    "md_mva": _prepare_md_row,
    "wa_dol": _prepare_wa_row,
}


def load_county_registrations(
    conn,
    *,
    source_key: str,
) -> dict[str, Any]:
    source = COUNTY_SOURCES[source_key]
    batch_id = f"{source.key}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"

    print(f"Fetching {source.name}...", file=sys.stderr, flush=True)
    rows = _fetch_socrata_all(source.endpoint)
    print(f"  Fetched {len(rows)} rows", file=sys.stderr, flush=True)

    prepare_fn = PREPARE_FNS[source_key]
    prepared = [
        record
        for record in (prepare_fn(row, import_batch_id=batch_id) for row in rows)
        if record
    ]

    if not prepared:
        return {"source": asdict(source), "rows_prepared": 0}

    conn.execute(
        "CREATE TEMP TABLE county_veh_stage"
        " (LIKE public.county_vehicle_registrations INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            f"COPY county_veh_stage ({', '.join(COPY_COLUMNS)}) FROM STDIN"
        ) as copy:
            for record in prepared:
                copy.write_row([record[col] for col in COPY_COLUMNS])

    columns = ", ".join(COPY_COLUMNS)
    update_columns = ", ".join(
        f"{col} = EXCLUDED.{col}"
        for col in COPY_COLUMNS
        if col not in {"county_name", "state", "source", "snapshot_date"}
    )
    conn.execute(
        f"""
        INSERT INTO public.county_vehicle_registrations ({columns})
        SELECT {columns}
        FROM county_veh_stage
        ON CONFLICT (county_name, state, source, snapshot_date)
        DO UPDATE SET {update_columns}, imported_at = NOW()
        """
    )
    conn.commit()

    print(f"  {source.key}: {len(prepared)} rows loaded", file=sys.stderr, flush=True)
    return {
        "source": asdict(source),
        "import_batch_id": batch_id,
        "fetched_rows": len(rows),
        "rows_prepared": len(prepared),
    }


def inspect_source_info(source_key: str | None = None) -> dict[str, Any]:
    if source_key:
        source = COUNTY_SOURCES[source_key]
        return {"source": asdict(source), "endpoint": source.endpoint}
    return {
        "sources": {k: asdict(v) for k, v in COUNTY_SOURCES.items()},
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    inspect = subcommands.add_parser("inspect-source")
    inspect.add_argument("--source", default=None, choices=sorted(COUNTY_SOURCES))

    load = subcommands.add_parser("load-county")
    load.add_argument("--state", required=True, choices=["TX", "MD", "WA"])

    load_all = subcommands.add_parser("load-all-counties")

    return parser


STATE_TO_SOURCE = {"TX": "tx_dmv", "MD": "md_mva", "WA": "wa_dol"}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "inspect-source":
        print(json.dumps(inspect_source_info(args.source), indent=2))
        return 0

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    with connect(args.database_url) as conn:
        if args.command == "load-county":
            source_key = STATE_TO_SOURCE[args.state]
            result = load_county_registrations(conn, source_key=source_key)
            print(json.dumps(result, indent=2, default=str))
        elif args.command == "load-all-counties":
            results = {}
            for key in COUNTY_SOURCES:
                results[key] = load_county_registrations(conn, source_key=key)
            print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
