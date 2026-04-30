#!/usr/bin/env python3
"""Load FHWA MV-1 state-level vehicle registration counts into Supabase."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

from supabase_migration import connect
from vehicle_sources import FHWA_MV1_KEY, get_vehicle_source


FHWA_ENDPOINT = "https://datahub.transportation.gov/resource/hwtm-7xmz.json"

STATE_REG_COPY_COLUMNS = [
    "state",
    "year",
    "auto_count",
    "bus_count",
    "truck_count",
    "motorcycle_count",
    "source",
    "source_dataset",
    "raw_payload",
    "import_batch_id",
]


def parse_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).strip()))
    except ValueError:
        return None


def prepare_state_registration_record(
    row: dict[str, Any],
    *,
    import_batch_id: str | None = None,
) -> dict[str, Any] | None:
    state = str(row.get("state") or "").strip()
    if not state:
        return None
    year = parse_int(row.get("year"))
    if year is None:
        return None

    return {
        "state": state,
        "year": year,
        "auto_count": parse_int(row.get("auto")),
        "bus_count": parse_int(row.get("bus")),
        "truck_count": parse_int(row.get("truck")),
        "motorcycle_count": parse_int(row.get("motorcycle")),
        "source": FHWA_MV1_KEY,
        "source_dataset": "hwtm-7xmz",
        "raw_payload": json.dumps(row, sort_keys=True, default=str),
        "import_batch_id": import_batch_id,
    }


def fhwa_api_url(*, start_year: int, end_year: int, limit: int = 50000, offset: int = 0) -> str:
    params = {
        "$where": f"year >= '{start_year}' AND year <= '{end_year}'",
        "$order": "year,state",
        "$limit": str(limit),
        "$offset": str(offset),
    }
    return f"{FHWA_ENDPOINT}?{urlencode(params)}"


def fetch_fhwa_rows(*, start_year: int, end_year: int, limit: int = 50000) -> list[dict[str, Any]]:
    url = fhwa_api_url(start_year=start_year, end_year=end_year, limit=limit)
    with urlopen(url, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def load_state_registration_rows(
    conn,
    *,
    rows: list[dict[str, Any]],
    import_batch_id: str,
) -> dict[str, int]:
    prepared = [
        record
        for record in (
            prepare_state_registration_record(row, import_batch_id=import_batch_id)
            for row in rows
        )
        if record
    ]
    if not prepared:
        return {"rows_prepared": 0}

    conn.execute(
        "CREATE TEMP TABLE state_veh_reg_stage"
        " (LIKE public.state_vehicle_registrations INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            f"COPY state_veh_reg_stage ({', '.join(STATE_REG_COPY_COLUMNS)}) FROM STDIN"
        ) as copy:
            for record in prepared:
                copy.write_row([record[col] for col in STATE_REG_COPY_COLUMNS])

    columns = ", ".join(STATE_REG_COPY_COLUMNS)
    update_columns = ", ".join(
        f"{col} = EXCLUDED.{col}"
        for col in STATE_REG_COPY_COLUMNS
        if col not in {"state", "year", "source"}
    )
    conn.execute(
        f"""
        INSERT INTO public.state_vehicle_registrations ({columns})
        SELECT {columns}
        FROM state_veh_reg_stage
        ON CONFLICT (state, year, source)
        DO UPDATE SET {update_columns}, imported_at = NOW()
        """
    )
    return {"rows_prepared": len(prepared)}


def load_fhwa_mv1(
    conn,
    *,
    start_year: int = 2015,
    end_year: int | None = None,
) -> dict[str, Any]:
    source = get_vehicle_source(FHWA_MV1_KEY)
    end = end_year or datetime.now(UTC).year
    batch_id = f"{source.key}-{start_year}-{end}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"

    rows = fetch_fhwa_rows(start_year=start_year, end_year=end)
    result = load_state_registration_rows(conn, rows=rows, import_batch_id=batch_id)
    conn.commit()
    print(f"{source.key}: {result['rows_prepared']} rows ({start_year}-{end})", file=sys.stderr, flush=True)
    return {
        "source": asdict(source),
        "import_batch_id": batch_id,
        "start_year": start_year,
        "end_year": end,
        "fetched_rows": len(rows),
        **result,
    }


def inspect_source_info() -> dict[str, Any]:
    source = get_vehicle_source(FHWA_MV1_KEY)
    return {
        "source": asdict(source),
        "endpoint": FHWA_ENDPOINT,
        "example_query": fhwa_api_url(start_year=2020, end_year=2023, limit=5),
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

    load = subcommands.add_parser("load-mv1")
    load.add_argument("--start-year", type=int, default=2015)
    load.add_argument("--end-year", type=int, default=None)

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
        if args.command == "load-mv1":
            result = load_fhwa_mv1(conn, start_year=args.start_year, end_year=args.end_year)
            print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
