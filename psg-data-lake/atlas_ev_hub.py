#!/usr/bin/env python3
"""Load Atlas EV Hub state EV registration data into Supabase."""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, date, datetime
from typing import Any, Iterable
from urllib.request import Request, urlopen

from supabase_migration import connect
from utils.normalize import normalize_zip
from vehicle_sources import (
    ATLAS_EV_HUB_KEY,
    ATLAS_STATES,
    REGIONS,
    atlas_csv_url,
    get_vehicle_source,
    region_states,
)


EV_REG_COPY_COLUMNS = [
    "zip",
    "state",
    "vehicle_count",
    "make",
    "model",
    "powertrain_type",
    "vehicle_category",
    "snapshot_date",
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


def prepare_ev_registration_record(
    row: dict[str, Any],
    *,
    snapshot_date: str,
    import_batch_id: str | None = None,
) -> dict[str, Any] | None:
    zip_code = normalize_zip(row.get("ZIP Code") or row.get("zip_code") or row.get("zip"))
    if not zip_code:
        return None
    vehicle_count = parse_int(row.get("Vehicle Count") or row.get("vehicle_count"))
    if vehicle_count is None or vehicle_count <= 0:
        return None

    raw_payload = {k: v for k, v in row.items()}
    return {
        "zip": zip_code,
        "state": (str(row.get("State") or row.get("state") or "").strip().upper() or None),
        "vehicle_count": vehicle_count,
        "make": (str(row.get("Vehicle Make") or row.get("make") or "").strip() or None),
        "model": (str(row.get("Vehicle Model") or row.get("model") or "").strip() or None),
        "powertrain_type": (str(row.get("Drivetrain Type") or row.get("Powertrain Type") or row.get("powertrain_type") or "").strip() or None),
        "vehicle_category": (str(row.get("Vehicle GVWR Category") or row.get("Vehicle Category") or row.get("vehicle_category") or "").strip() or None),
        "snapshot_date": snapshot_date,
        "source": ATLAS_EV_HUB_KEY,
        "source_dataset": "atlas_ev_hub",
        "raw_payload": json.dumps(raw_payload, sort_keys=True, default=str),
        "import_batch_id": import_batch_id,
    }


def atlas_csv_url_for_state(state_abbr: str, month: str | None = None) -> str:
    return atlas_csv_url(state_abbr, month=month)


def fetch_atlas_csv_rows(state_abbr: str, *, month: str | None = None, latest_only: bool = True) -> Iterable[dict[str, Any]]:
    url = atlas_csv_url_for_state(state_abbr, month=month)
    req = Request(url, headers={"User-Agent": "PSG-DataLake/1.0"})
    with urlopen(req, timeout=300) as response:
        text_stream = io.TextIOWrapper(response, encoding="utf-8-sig", newline="")
        for row in csv.DictReader(text_stream):
            if latest_only and row.get("Latest DMV Snapshot Flag", "").strip().lower() == "false":
                continue
            yield row


BATCH_SIZE = 50_000


def _upsert_ev_batch(conn, prepared: list[dict[str, Any]]) -> int:
    conn.execute(
        "CREATE TEMP TABLE ev_reg_stage"
        " (LIKE public.ev_registrations INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            f"COPY ev_reg_stage ({', '.join(EV_REG_COPY_COLUMNS)}) FROM STDIN"
        ) as copy:
            for record in prepared:
                copy.write_row([record[col] for col in EV_REG_COPY_COLUMNS])

    columns = ", ".join(EV_REG_COPY_COLUMNS)
    update_columns = ", ".join(
        f"{col} = EXCLUDED.{col}"
        for col in EV_REG_COPY_COLUMNS
        if col not in {"zip", "source", "snapshot_date", "make", "model", "powertrain_type"}
    )
    conflict_expr = "zip, source, snapshot_date, COALESCE(make, ''), COALESCE(model, ''), COALESCE(powertrain_type, '')"
    conn.execute(
        f"""
        INSERT INTO public.ev_registrations ({columns})
        SELECT DISTINCT ON ({conflict_expr}) {columns}
        FROM ev_reg_stage
        ORDER BY {conflict_expr}, vehicle_count DESC
        ON CONFLICT (zip, source, snapshot_date, COALESCE(make, ''), COALESCE(model, ''), COALESCE(powertrain_type, ''))
        DO UPDATE SET {update_columns}, imported_at = NOW()
        """
    )
    conn.commit()
    return len(prepared)


def load_ev_registration_rows(
    conn,
    *,
    rows: Iterable[dict[str, Any]],
    state_abbr: str,
    snapshot_date: str,
    import_batch_id: str,
    batch_size: int = BATCH_SIZE,
) -> dict[str, int]:
    total = 0
    batch: list[dict[str, Any]] = []
    for row in rows:
        record = prepare_ev_registration_record(row, snapshot_date=snapshot_date, import_batch_id=import_batch_id)
        if record:
            batch.append(record)
        if len(batch) >= batch_size:
            total += _upsert_ev_batch(conn, batch)
            print(f"  {state_abbr}: {total} rows", file=sys.stderr, flush=True)
            batch = []
    if batch:
        total += _upsert_ev_batch(conn, batch)
    return {"rows_prepared": total}


def load_atlas_state(
    conn,
    *,
    state_abbr: str,
    snapshot_date: str | None = None,
) -> dict[str, Any]:
    source = get_vehicle_source(ATLAS_EV_HUB_KEY)
    snapshot = snapshot_date or date.today().isoformat()
    batch_id = f"{source.key}-{state_abbr}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"

    rows = fetch_atlas_csv_rows(state_abbr)
    result = load_ev_registration_rows(
        conn,
        rows=rows,
        state_abbr=state_abbr,
        snapshot_date=snapshot,
        import_batch_id=batch_id,
    )
    print(f"{source.key} {state_abbr}: {result['rows_prepared']} rows", file=sys.stderr, flush=True)
    return {
        "source": asdict(source),
        "state": state_abbr,
        "import_batch_id": batch_id,
        "snapshot_date": snapshot,
        **result,
    }


def load_atlas_region(
    conn,
    *,
    region: str,
    snapshot_date: str | None = None,
) -> dict[str, Any]:
    states = region_states(region)
    results: dict[str, Any] = {}
    for state in states:
        results[state] = load_atlas_state(conn, state_abbr=state, snapshot_date=snapshot_date)
    return {"region": region, "states": results}


def inspect_source_info() -> dict[str, Any]:
    source = get_vehicle_source(ATLAS_EV_HUB_KEY)
    return {
        "source": asdict(source),
        "available_states": sorted(ATLAS_STATES),
        "regions": {name: states for name, states in REGIONS.items()},
        "example_csv_url": atlas_csv_url_for_state("NY"),
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

    load_state = subcommands.add_parser("load-state")
    load_state.add_argument("--state", required=True, choices=sorted(ATLAS_STATES))
    load_state.add_argument("--snapshot-date", default=date.today().isoformat())

    load_region = subcommands.add_parser("load-region")
    load_region.add_argument("--region", required=True, choices=sorted(REGIONS))
    load_region.add_argument("--snapshot-date", default=date.today().isoformat())

    load_all = subcommands.add_parser("load-all")
    load_all.add_argument("--snapshot-date", default=date.today().isoformat())

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
        if args.command == "load-state":
            result = load_atlas_state(conn, state_abbr=args.state, snapshot_date=args.snapshot_date)
            print(json.dumps(result, indent=2, default=str))
        elif args.command == "load-region":
            result = load_atlas_region(conn, region=args.region, snapshot_date=args.snapshot_date)
            print(json.dumps(result, indent=2, default=str))
        elif args.command == "load-all":
            results = {}
            for state in sorted(ATLAS_STATES):
                results[state] = load_atlas_state(conn, state_abbr=state, snapshot_date=args.snapshot_date)
            print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
