#!/usr/bin/env python3
"""Load ACS ZIP/ZCTA household income metrics into Supabase."""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

from supabase_migration import connect
from utils.normalize import normalize_zip


ACS5_ENDPOINT_TEMPLATE = "https://api.census.gov/data/{year}/acs/acs5"
ACS_VARIABLES = [
    "NAME",
    "B11001_001E",  # households
    "B19013_001E",  # median household income
    "B19025_001E",  # aggregate household income
]


@dataclass(frozen=True)
class CensusIncomeSource:
    key: str
    provider: str
    url_template: str
    geography: str
    cadence: str
    note: str
    variables: list[str]


def canonical_income_source() -> CensusIncomeSource:
    return CensusIncomeSource(
        key="acs5_zcta_income",
        provider="us_census",
        url_template=ACS5_ENDPOINT_TEMPLATE,
        geography="zcta",
        cadence="annual",
        note="Median from B19013_001E; mean computed as B19025_001E / B11001_001E",
        variables=ACS_VARIABLES,
    )


def parse_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(str(value))
    except ValueError:
        return None


def parse_decimal(value: Any) -> Decimal | None:
    if value in (None, "", "null"):
        return None
    try:
        dec = Decimal(str(value))
    except InvalidOperation:
        return None
    if dec.is_nan() or dec.is_infinite():
        return None
    return dec


def fetch_census_income_rows(
    year: int,
    *,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    endpoint = ACS5_ENDPOINT_TEMPLATE.format(year=year)
    params = {
        "get": ",".join(ACS_VARIABLES),
        "for": "zip code tabulation area:*",
    }
    if api_key:
        params["key"] = api_key
    url = f"{endpoint}?{urlencode(params)}"
    with urlopen(url, timeout=120) as response:
        payload = response.read().decode("utf-8")
    rows = json.loads(payload)
    header = rows[0]
    records: list[dict[str, Any]] = []
    for values in rows[1:]:
        records.append(dict(zip(header, values, strict=False)))
    return records


def prepare_income_record(row: dict[str, Any], *, year: int) -> dict[str, Any] | None:
    zip_code = normalize_zip(row.get("zip code tabulation area"))
    if not zip_code:
        return None
    households = parse_int(row.get("B11001_001E"))
    median_income = parse_decimal(row.get("B19013_001E"))
    aggregate_income = parse_decimal(row.get("B19025_001E"))
    mean_income: Decimal | None = None
    if households and households > 0 and aggregate_income is not None:
        mean_income = aggregate_income / Decimal(households)
    return {
        "year": year,
        "zip": zip_code,
        "name": row.get("NAME"),
        "households": households,
        "aggregate_household_income": aggregate_income,
        "mean_household_income": mean_income,
        "median_household_income": median_income,
        "source": "us_census",
        "source_table": "acs5.B11001/B19013/B19025",
        "raw_payload": json.dumps(row, sort_keys=True),
    }


def load_income_rows(
    conn,
    *,
    year: int,
    rows: list[dict[str, Any]],
    ny_focus_only: bool = False,
) -> dict[str, int]:
    prepared = [record for record in (prepare_income_record(row, year=year) for row in rows) if record]
    if ny_focus_only:
        zips = conn.execute(
            """
            SELECT DISTINCT zr.zip_code
            FROM zip_references zr
            JOIN county_references cr ON cr.county_fips = zr.county_fips
            WHERE cr.state_abbr = 'NY'
              AND (
                cr.county_name ILIKE 'Bronx%%'
                OR cr.county_name ILIKE 'Kings%%'
                OR cr.county_name ILIKE 'New York%%'
                OR cr.county_name ILIKE 'Queens%%'
                OR cr.county_name ILIKE 'Richmond%%'
                OR cr.county_name ILIKE 'Nassau%%'
                OR cr.county_name ILIKE 'Suffolk%%'
              )
            """
        ).fetchall()
        allowed = {row[0] for row in zips}
        prepared = [record for record in prepared if record["zip"] in allowed]

    conn.execute("CREATE TEMP TABLE zcta_income_annual_stage (LIKE public.zcta_income_annual INCLUDING DEFAULTS) ON COMMIT DROP")
    with conn.cursor() as cur:
        with cur.copy(
            """
            COPY zcta_income_annual_stage (
              year, zip, name, households, aggregate_household_income,
              mean_household_income, median_household_income, source, source_table, raw_payload
            ) FROM STDIN
            """
        ) as copy:
            for record in prepared:
                copy.write_row([
                    record["year"],
                    record["zip"],
                    record["name"],
                    record["households"],
                    str(record["aggregate_household_income"]) if record["aggregate_household_income"] is not None else None,
                    str(record["mean_household_income"]) if record["mean_household_income"] is not None else None,
                    str(record["median_household_income"]) if record["median_household_income"] is not None else None,
                    record["source"],
                    record["source_table"],
                    record["raw_payload"],
                ])
    conn.execute(
        """
        INSERT INTO public.zcta_income_annual (
          year, zip, name, households, aggregate_household_income,
          mean_household_income, median_household_income, source, source_table, raw_payload
        )
        SELECT
          year, zip, name, households, aggregate_household_income,
          mean_household_income, median_household_income, source, source_table, raw_payload
        FROM zcta_income_annual_stage
        ON CONFLICT (year, zip)
        DO UPDATE SET
          name = EXCLUDED.name,
          households = EXCLUDED.households,
          aggregate_household_income = EXCLUDED.aggregate_household_income,
          mean_household_income = EXCLUDED.mean_household_income,
          median_household_income = EXCLUDED.median_household_income,
          source = EXCLUDED.source,
          source_table = EXCLUDED.source_table,
          raw_payload = EXCLUDED.raw_payload,
          imported_at = NOW()
        """
    )
    return {
        "rows_prepared": len(prepared),
    }


def inspect_source(year: int) -> dict[str, Any]:
    source = canonical_income_source()
    return {
        "source": asdict(source),
        "year": year,
        "endpoint": ACS5_ENDPOINT_TEMPLATE.format(year=year),
        "example_query": (
            f"{ACS5_ENDPOINT_TEMPLATE.format(year=year)}?"
            + urlencode({"get": ",".join(source.variables), "for": "zip code tabulation area:*"})
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

    load = subcommands.add_parser("load-zcta-income")
    load.add_argument("--year", type=int, default=2023)
    load.add_argument("--ny-focus-only", action="store_true")
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
        rows = fetch_census_income_rows(args.year, api_key=census_api_key)
        result = load_income_rows(
            conn,
            year=args.year,
            rows=rows,
            ny_focus_only=args.ny_focus_only,
        )
        result.update({
            "year": args.year,
            "ny_focus_only": args.ny_focus_only,
            "loaded_at": datetime.now(tz=UTC).isoformat(),
        })
        print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
