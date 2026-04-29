#!/usr/bin/env python3
"""Load NY DMV vehicle registration counts by ZIP into Supabase."""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

from supabase_migration import connect
from utils.normalize import normalize_zip


SODA_ENDPOINT = "https://data.ny.gov/resource/w4pv-hbkt.json"

NY_FOCUS_COUNTIES = [
    "NASSAU",
    "SUFFOLK",
    "BRONX",
    "KINGS",
    "NEW YORK",
    "QUEENS",
    "RICHMOND",
]


@dataclass(frozen=True)
class DmvRegistrationSource:
    key: str
    provider: str
    endpoint: str
    dataset_id: str
    cadence: str
    note: str


def canonical_source() -> DmvRegistrationSource:
    return DmvRegistrationSource(
        key="ny_dmv_vehicle_registrations",
        provider="ny_dmv",
        endpoint=SODA_ENDPOINT,
        dataset_id="w4pv-hbkt",
        cadence="snapshot",
        note="Vehicle registrations grouped by ZIP. record_type=VEH only.",
    )


def parse_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(str(value))
    except ValueError:
        return None


def fetch_dmv_registration_counts(
    *,
    ny_focus_only: bool = False,
    app_token: str | None = None,
) -> list[dict[str, Any]]:
    select = (
        "zip,"
        "count(*) as total_vehicles,"
        "sum(case(registration_class='PAS',1,true,0)) as passenger_vehicles,"
        "sum(case(registration_class='COM',1,true,0)) as commercial_vehicles"
    )
    where = "record_type='VEH' AND state='NY'"
    if ny_focus_only:
        county_list = ",".join(f"'{c}'" for c in NY_FOCUS_COUNTIES)
        where += f" AND county in({county_list})"

    params: dict[str, str] = {
        "$select": select,
        "$where": where,
        "$group": "zip",
        "$limit": "50000",
    }
    if app_token:
        params["$$app_token"] = app_token

    url = f"{SODA_ENDPOINT}?{urlencode(params)}"
    with urlopen(url, timeout=120) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def prepare_registration_record(
    row: dict[str, Any],
    *,
    snapshot_date: str,
) -> dict[str, Any] | None:
    zip_code = normalize_zip(row.get("zip"))
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
        "source": "ny_dmv",
        "source_dataset": "w4pv-hbkt",
        "raw_payload": json.dumps(row, sort_keys=True),
    }


def load_registration_rows(
    conn,
    *,
    rows: list[dict[str, Any]],
    snapshot_date: str,
) -> dict[str, int]:
    prepared = [
        record
        for record in (prepare_registration_record(row, snapshot_date=snapshot_date) for row in rows)
        if record
    ]
    if not prepared:
        return {"rows_prepared": 0}

    conn.execute(
        "CREATE TEMP TABLE dmv_veh_reg_stage"
        " (LIKE public.dmv_vehicle_registrations INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            """
            COPY dmv_veh_reg_stage (
              zip, vehicle_count, passenger_count, commercial_count,
              snapshot_date, source, source_dataset, raw_payload
            ) FROM STDIN
            """
        ) as copy:
            for record in prepared:
                copy.write_row([
                    record["zip"],
                    record["vehicle_count"],
                    record["passenger_count"],
                    record["commercial_count"],
                    record["snapshot_date"],
                    record["source"],
                    record["source_dataset"],
                    record["raw_payload"],
                ])
    conn.execute(
        """
        INSERT INTO public.dmv_vehicle_registrations (
          zip, vehicle_count, passenger_count, commercial_count,
          snapshot_date, source, source_dataset, raw_payload
        )
        SELECT
          zip, vehicle_count, passenger_count, commercial_count,
          snapshot_date, source, source_dataset, raw_payload
        FROM dmv_veh_reg_stage
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


def inspect_source() -> dict[str, Any]:
    source = canonical_source()
    return {
        "source": asdict(source),
        "example_query": (
            f"{SODA_ENDPOINT}?"
            + urlencode({
                "$select": "zip_code,count(*) as total",
                "$where": "record_type='VEH' AND state='NY'",
                "$group": "zip",
                "$limit": "5",
            })
        ),
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

    load = subcommands.add_parser("load-dmv-registrations")
    load.add_argument("--ny-focus-only", action="store_true")
    load.add_argument("--snapshot-date", default=date.today().isoformat())
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "inspect-source":
        print(json.dumps(inspect_source(), indent=2))
        return 0
    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")
    app_token = os.getenv("SODA_APP_TOKEN")
    with connect(args.database_url) as conn:
        rows = fetch_dmv_registration_counts(
            ny_focus_only=args.ny_focus_only,
            app_token=app_token,
        )
        result = load_registration_rows(
            conn,
            rows=rows,
            snapshot_date=args.snapshot_date,
        )
        result.update({
            "ny_focus_only": args.ny_focus_only,
            "snapshot_date": args.snapshot_date,
            "loaded_at": datetime.now(tz=UTC).isoformat(),
        })
        print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
