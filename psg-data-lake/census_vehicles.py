#!/usr/bin/env python3
"""Load ACS5 household vehicle availability metrics into Supabase.

Source: Census Bureau ACS 5-Year Estimates.
Tables: B25046 (aggregate vehicles), B25044 (distribution by tenure).
Loads into zcta_vehicle_availability table at ZCTA geography.
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
from urllib.request import urlopen

from supabase_migration import connect
from utils.normalize import normalize_zip


ACS5_ENDPOINT_TEMPLATE = "https://api.census.gov/data/{year}/acs/acs5"

ACS_VEHICLE_AGG_VARIABLES = [
    "NAME",
    "B25046_001E",
    "B25046_001M",
    "B25046_002E",
    "B25046_003E",
]

ACS_VEHICLE_DIST_VARIABLES = [
    "NAME",
    "B25044_001E",
    "B25044_002E",
    "B25044_003E",
    "B25044_004E",
    "B25044_005E",
    "B25044_006E",
    "B25044_007E",
    "B25044_008E",
    "B25044_009E",
    "B25044_010E",
    "B25044_011E",
    "B25044_012E",
    "B25044_013E",
    "B25044_014E",
    "B25044_015E",
]

COPY_COLUMNS = [
    "zcta",
    "year",
    "aggregate_vehicles",
    "aggregate_vehicles_moe",
    "owner_vehicles",
    "renter_vehicles",
    "total_occupied_units",
    "owner_occupied",
    "owner_0veh",
    "owner_1veh",
    "owner_2veh",
    "owner_3veh",
    "owner_4veh",
    "owner_5plus",
    "renter_occupied",
    "renter_0veh",
    "renter_1veh",
    "renter_2veh",
    "renter_3veh",
    "renter_4veh",
    "renter_5plus",
    "source",
    "source_table",
    "raw_payload",
]


@dataclass(frozen=True)
class CensusVehicleSource:
    key: str
    provider: str
    url_template: str
    geography: str
    cadence: str
    note: str
    agg_variables: list[str]
    dist_variables: list[str]


def canonical_vehicle_source() -> CensusVehicleSource:
    return CensusVehicleSource(
        key="acs5_zcta_vehicles",
        provider="us_census",
        url_template=ACS5_ENDPOINT_TEMPLATE,
        geography="zcta",
        cadence="annual",
        note=(
            "B25046_001E = aggregate vehicles available (direct count). "
            "B25044 = distribution by tenure and vehicle count bins."
        ),
        agg_variables=ACS_VEHICLE_AGG_VARIABLES,
        dist_variables=ACS_VEHICLE_DIST_VARIABLES,
    )


CENSUS_SENTINELS = {-666666666, -999999999, -888888888, -222222222, -333333333}


def parse_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        v = int(str(value))
    except ValueError:
        return None
    if v in CENSUS_SENTINELS:
        return None
    return v


def fetch_census_vehicle_rows(
    year: int,
    *,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    endpoint = ACS5_ENDPOINT_TEMPLATE.format(year=year)
    all_vars = list(dict.fromkeys(ACS_VEHICLE_AGG_VARIABLES + ACS_VEHICLE_DIST_VARIABLES))
    params = {
        "get": ",".join(all_vars),
        "for": "zip code tabulation area:*",
    }
    if api_key:
        params["key"] = api_key
    url = f"{endpoint}?{urlencode(params)}"
    print(f"Fetching Census ACS5 vehicle data for {year}...", file=sys.stderr, flush=True)
    with urlopen(url, timeout=300) as response:
        payload = response.read().decode("utf-8")
    rows = json.loads(payload)
    header = rows[0]
    records: list[dict[str, Any]] = []
    for values in rows[1:]:
        records.append(dict(zip(header, values, strict=False)))
    print(f"  Fetched {len(records)} ZCTAs", file=sys.stderr, flush=True)
    return records


def prepare_vehicle_record(row: dict[str, Any], *, year: int) -> dict[str, Any] | None:
    zcta = normalize_zip(row.get("zip code tabulation area"))
    if not zcta:
        return None

    aggregate_vehicles = parse_int(row.get("B25046_001E"))
    aggregate_vehicles_moe = parse_int(row.get("B25046_001M"))
    owner_vehicles = parse_int(row.get("B25046_002E"))
    renter_vehicles = parse_int(row.get("B25046_003E"))

    total_occupied = parse_int(row.get("B25044_001E"))
    owner_occupied = parse_int(row.get("B25044_002E"))
    owner_0 = parse_int(row.get("B25044_003E"))
    owner_1 = parse_int(row.get("B25044_004E"))
    owner_2 = parse_int(row.get("B25044_005E"))
    owner_3 = parse_int(row.get("B25044_006E"))
    owner_4 = parse_int(row.get("B25044_007E"))
    owner_5p = parse_int(row.get("B25044_008E"))
    renter_occupied = parse_int(row.get("B25044_009E"))
    renter_0 = parse_int(row.get("B25044_010E"))
    renter_1 = parse_int(row.get("B25044_011E"))
    renter_2 = parse_int(row.get("B25044_012E"))
    renter_3 = parse_int(row.get("B25044_013E"))
    renter_4 = parse_int(row.get("B25044_014E"))
    renter_5p = parse_int(row.get("B25044_015E"))

    return {
        "zcta": zcta,
        "year": year,
        "aggregate_vehicles": aggregate_vehicles,
        "aggregate_vehicles_moe": aggregate_vehicles_moe,
        "owner_vehicles": owner_vehicles,
        "renter_vehicles": renter_vehicles,
        "total_occupied_units": total_occupied,
        "owner_occupied": owner_occupied,
        "owner_0veh": owner_0,
        "owner_1veh": owner_1,
        "owner_2veh": owner_2,
        "owner_3veh": owner_3,
        "owner_4veh": owner_4,
        "owner_5plus": owner_5p,
        "renter_occupied": renter_occupied,
        "renter_0veh": renter_0,
        "renter_1veh": renter_1,
        "renter_2veh": renter_2,
        "renter_3veh": renter_3,
        "renter_4veh": renter_4,
        "renter_5plus": renter_5p,
        "source": "us_census",
        "source_table": "acs5.B25046/B25044",
        "raw_payload": json.dumps(row, sort_keys=True),
    }


def load_vehicle_rows(
    conn,
    *,
    year: int,
    rows: list[dict[str, Any]],
) -> dict[str, int]:
    prepared = [
        record
        for record in (prepare_vehicle_record(row, year=year) for row in rows)
        if record
    ]
    if not prepared:
        return {"rows_prepared": 0}

    conn.execute(
        "CREATE TEMP TABLE zcta_vehicle_stage"
        " (LIKE public.zcta_vehicle_availability INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            f"COPY zcta_vehicle_stage ({', '.join(COPY_COLUMNS)}) FROM STDIN"
        ) as copy:
            for record in prepared:
                copy.write_row([record[col] for col in COPY_COLUMNS])

    columns = ", ".join(COPY_COLUMNS)
    update_columns = ", ".join(
        f"{col} = EXCLUDED.{col}"
        for col in COPY_COLUMNS
        if col not in {"zcta", "year"}
    )
    conn.execute(
        f"""
        INSERT INTO public.zcta_vehicle_availability ({columns})
        SELECT {columns}
        FROM zcta_vehicle_stage
        ON CONFLICT (zcta, year)
        DO UPDATE SET {update_columns}, imported_at = NOW()
        """
    )
    return {"rows_prepared": len(prepared)}


def inspect_source(year: int) -> dict[str, Any]:
    source = canonical_vehicle_source()
    all_vars = list(dict.fromkeys(source.agg_variables + source.dist_variables))
    return {
        "source": asdict(source),
        "year": year,
        "endpoint": ACS5_ENDPOINT_TEMPLATE.format(year=year),
        "total_variables": len(all_vars),
        "example_query": (
            f"{ACS5_ENDPOINT_TEMPLATE.format(year=year)}?"
            + urlencode({"get": ",".join(all_vars), "for": "zip code tabulation area:*"})
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

    inspect = subcommands.add_parser("inspect-source")
    inspect.add_argument("--year", type=int, default=2023)

    load = subcommands.add_parser("load-vehicles")
    load.add_argument("--year", type=int, default=2023)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "inspect-source":
        print(json.dumps(inspect_source(args.year), indent=2))
        return 0

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    census_api_key = os.getenv("CENSUS_API_KEY")

    with connect(args.database_url) as conn:
        rows = fetch_census_vehicle_rows(args.year, api_key=census_api_key)
        result = load_vehicle_rows(conn, year=args.year, rows=rows)
        conn.commit()
        result.update({
            "year": args.year,
            "loaded_at": datetime.now(tz=UTC).isoformat(),
        })
        print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
