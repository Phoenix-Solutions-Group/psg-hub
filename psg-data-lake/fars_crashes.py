#!/usr/bin/env python3
"""Load NHTSA FARS (Fatality Analysis Reporting System) national crash data."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Iterable
from urllib.request import urlopen

from crash_sources import CRASH_SOURCES, CrashSource, get_crash_source
from supabase_migration import clean_copy_value, connect, copy_rows


FARS_KEY = "fars_crashes"
FARS_API_BASE = "https://crashviewer.nhtsa.dot.gov/CrashAPI"
FARS_CRASHES_ENDPOINT = f"{FARS_API_BASE}/crashes/GetCrashesByState"
FARS_LANDING_URL = "https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars"

# FARS lat/lon sentinel values meaning "unknown location"
FARS_LAT_SENTINELS = {77.7777, 88.8888, 99.9999}
FARS_LNG_SENTINELS = {77.7777, 88.8888, 99.9999}

# Standard FIPS codes for all 50 states + DC
STATE_FIPS: dict[str, str] = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
    "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
    "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY",
}

# Reverse map: abbreviation -> FIPS
STATE_ABBR_TO_FIPS: dict[str, str] = {abbr: fips for fips, abbr in STATE_FIPS.items()}

CRASH_EVENT_COPY_COLUMNS = [
    "source",
    "source_event_id",
    "event_time",
    "reported_time",
    "state",
    "city",
    "latitude",
    "longitude",
    "location",
    "severity",
    "fatalities",
    "injuries_total",
    "injuries_incapacitating",
    "vehicles_involved",
    "damage",
    "weather_condition",
    "roadway_surface_condition",
    "collision_type",
    "primary_contributory_cause",
    "source_lag_days",
    "confidence_score",
    "import_batch_id",
    "raw_payload",
]


def parse_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).strip()))
    except (ValueError, TypeError):
        return None


def parse_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def build_fars_location_wkt(latitude: Any, longitude: Any) -> str | None:
    lat = parse_float(latitude)
    lng = parse_float(longitude)
    if lat is None or lng is None:
        return None
    # Filter FARS sentinel values for unknown location
    if lat in FARS_LAT_SENTINELS or lng in FARS_LNG_SENTINELS:
        return None
    # Bounds check: contiguous US + AK/HI + territories
    if not (18.0 <= lat <= 72.0 and -180.0 <= lng <= -60.0):
        return None
    return f"SRID=4326;POINT({lng} {lat})"


def build_fars_event_time(row: dict[str, Any]) -> str | None:
    """Build an ISO timestamp from FARS YEAR/MONTH/DAY/HOUR/MINUTE fields.

    FARS uses 99 as a sentinel for unknown values in time fields.
    Returns None if any of YEAR/MONTH/DAY are missing or unknown.
    Returns date-only if HOUR or MINUTE are unknown (99).
    """
    year = parse_int(row.get("YEAR"))
    month = parse_int(row.get("MONTH"))
    day = parse_int(row.get("DAY"))

    if not year or not month or not day:
        return None
    if month == 99 or day == 99:
        return None

    hour = parse_int(row.get("HOUR"))
    minute = parse_int(row.get("MINUTE"))

    # FARS uses 99 for unknown hour/minute
    if hour is None or hour == 99 or minute is None or minute == 99:
        return f"{year:04d}-{month:02d}-{day:02d}"

    return f"{year:04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:00"


def prepare_fars_crash_record(
    row: dict[str, Any],
    *,
    import_batch_id: str | None = None,
) -> dict[str, Any]:
    raw_payload = {key: clean_copy_value(value) for key, value in row.items()}

    state_fips = str(row.get("STATE") or "").strip().zfill(2)
    state_abbr = STATE_FIPS.get(state_fips, state_fips)
    city_name = str(row.get("CITYNAME") or "").strip() or None
    st_case = str(row.get("ST_CASE") or "").strip()
    year_val = str(row.get("YEAR") or "").strip()
    source_event_id = f"fars-{state_fips}-{st_case}-{year_val}"

    latitude = parse_float(row.get("LATITUDE"))
    longitude = parse_float(row.get("LONGITUD"))

    # Filter FARS sentinel coordinates before storing
    lat_stored: float | None = None
    lng_stored: float | None = None
    if latitude is not None and latitude not in FARS_LAT_SENTINELS:
        lat_stored = latitude
    if longitude is not None and longitude not in FARS_LNG_SENTINELS:
        lng_stored = longitude

    location_wkt = build_fars_location_wkt(lat_stored, lng_stored) if lat_stored and lng_stored else None
    has_location = location_wkt is not None

    event_time = build_fars_event_time(row)

    prepared = {
        "source": FARS_KEY,
        "source_event_id": source_event_id,
        "event_time": event_time,
        "reported_time": None,
        "state": state_abbr,
        "city": city_name,
        "latitude": Decimal(str(lat_stored)) if lat_stored is not None else None,
        "longitude": Decimal(str(lng_stored)) if lng_stored is not None else None,
        "location": location_wkt,
        "severity": "fatal",
        "fatalities": parse_int(row.get("FATALS")),
        "injuries_total": None,
        "injuries_incapacitating": None,
        "vehicles_involved": parse_int(row.get("VE_TOTAL")),
        "damage": None,
        "weather_condition": None,
        "roadway_surface_condition": None,
        "collision_type": None,
        "primary_contributory_cause": str(row.get("DRUNK_DR") or "").strip() or None,
        "source_lag_days": None,
        "confidence_score": Decimal("0.95") if has_location else Decimal("0.70"),
        "import_batch_id": import_batch_id,
        "raw_payload": json.dumps(raw_payload, sort_keys=True, default=str, allow_nan=False),
    }
    return prepared


def fars_api_url(*, state_fips: str, year: int) -> str:
    return (
        f"{FARS_CRASHES_ENDPOINT}"
        f"?stateCase={state_fips}&fromYear={year}&toYear={year}&format=json"
    )


def fetch_fars_state_year(*, state_fips: str, year: int) -> list[dict[str, Any]]:
    url = fars_api_url(state_fips=state_fips, year=year)
    with urlopen(url, timeout=120) as response:
        payload = json.load(response)
    # FARS CrashAPI wraps results in {"Count": N, "Message": "...", "Results": [[...], ...]}
    if isinstance(payload, dict):
        results = payload.get("Results", [])
        if results and isinstance(results[0], list):
            return results[0]
        return results
    # Sometimes returns a bare list
    if isinstance(payload, list):
        return payload
    return []


def copy_crash_event_rows(conn, records: list[dict[str, Any]]) -> int:
    conn.execute(
        "CREATE TEMP TABLE crash_events_stage (LIKE crash_events INCLUDING DEFAULTS) ON COMMIT DROP;"
    )
    rows = ([record.get(column) for column in CRASH_EVENT_COPY_COLUMNS] for record in records)
    copied = copy_rows(conn, "crash_events_stage", CRASH_EVENT_COPY_COLUMNS, rows)
    columns = ", ".join(CRASH_EVENT_COPY_COLUMNS)
    update_columns = ", ".join(
        f"{column} = EXCLUDED.{column}"
        for column in CRASH_EVENT_COPY_COLUMNS
        if column not in {"source", "source_event_id"}
    )
    conn.execute(
        f"""
        INSERT INTO crash_events ({columns})
        SELECT {columns}
        FROM crash_events_stage
        WHERE source_event_id IS NOT NULL
          AND source_event_id <> ''
        ON CONFLICT (source, source_event_id)
        DO UPDATE SET {update_columns}, imported_at = NOW()
        """
    )
    return copied


def record_fars_event_source(
    conn,
    source: CrashSource,
    *,
    state_abbr: str,
    source_year: int,
    row_count: int,
    status: str,
    import_batch_id: str,
    notes: str | None = None,
) -> None:
    geography = f"United States - {state_abbr}"
    conn.execute(
        """
        INSERT INTO crash_event_sources (
          source_key,
          source_url,
          geography,
          source_year,
          row_count,
          status,
          import_batch_id,
          notes
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_key, geography, source_year)
        DO UPDATE SET
          row_count = EXCLUDED.row_count,
          status = EXCLUDED.status,
          import_batch_id = EXCLUDED.import_batch_id,
          notes = EXCLUDED.notes,
          imported_at = NOW()
        """,
        (
            source.key,
            source.source_url,
            geography,
            source_year,
            row_count,
            status,
            import_batch_id,
            notes,
        ),
    )


def load_fars_state(
    conn,
    *,
    state_fips: str,
    year: int,
    import_batch_id: str,
) -> dict[str, Any]:
    source = get_crash_source(FARS_KEY)
    state_abbr = STATE_FIPS.get(state_fips.zfill(2), state_fips)
    raw_rows = fetch_fars_state_year(state_fips=state_fips, year=year)
    records = [
        prepare_fars_crash_record(row, import_batch_id=import_batch_id)
        for row in raw_rows
    ]
    loaded = copy_crash_event_rows(conn, records)
    conn.commit()
    print(f"{FARS_KEY} {state_abbr} {year}: {loaded} rows", file=sys.stderr, flush=True)
    record_fars_event_source(
        conn,
        source,
        state_abbr=state_abbr,
        source_year=year,
        row_count=loaded,
        status="loaded",
        import_batch_id=import_batch_id,
        notes=f"FARS fatal crashes for {state_abbr} {year}",
    )
    conn.commit()
    return {
        "state": state_abbr,
        "state_fips": state_fips,
        "year": year,
        "loaded": loaded,
    }


def load_fars_year(conn, *, year: int) -> dict[str, Any]:
    import_batch_id = f"{FARS_KEY}-{year}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    results: list[dict[str, Any]] = []
    total = 0
    for fips in sorted(STATE_FIPS.keys()):
        try:
            result = load_fars_state(conn, state_fips=fips, year=year, import_batch_id=import_batch_id)
            results.append(result)
            total += result["loaded"]
        except Exception as exc:
            state_abbr = STATE_FIPS.get(fips, fips)
            print(
                f"WARNING: {FARS_KEY} {state_abbr} {year} failed: {exc}",
                file=sys.stderr,
                flush=True,
            )
            results.append({"state": state_abbr, "state_fips": fips, "year": year, "loaded": 0, "error": str(exc)})
    return {
        "source": asdict(get_crash_source(FARS_KEY)),
        "import_batch_id": import_batch_id,
        "year": year,
        "total_loaded": total,
        "states": results,
    }


def inspect_fars_source(*, year: int, state_abbr: str | None = None) -> dict[str, Any]:
    source = get_crash_source(FARS_KEY)
    if state_abbr:
        fips = STATE_ABBR_TO_FIPS.get(state_abbr.upper(), "")
        example_url = fars_api_url(state_fips=fips, year=year)
    else:
        example_url = fars_api_url(state_fips="17", year=year)
    return {
        "source": asdict(source),
        "year": year,
        "example_url": example_url,
        "available_states": STATE_FIPS,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    inspect = subcommands.add_parser(
        "inspect-source",
        help="Print source metadata and an example API URL",
    )
    inspect.add_argument("--year", type=int, default=2022)
    inspect.add_argument("--state", help="Two-letter state abbreviation for example URL (default: IL)")

    load_state = subcommands.add_parser(
        "load-state",
        help="Load FARS fatal crashes for one state and year",
    )
    load_state.add_argument("--state", required=True, help="Two-letter state abbreviation (e.g. IL)")
    load_state.add_argument("--year", type=int, required=True)

    load_year = subcommands.add_parser(
        "load-year",
        help="Load FARS fatal crashes for all states for a given year",
    )
    load_year.add_argument("--year", type=int, required=True)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "inspect-source":
        print(json.dumps(
            inspect_fars_source(year=args.year, state_abbr=args.state),
            indent=2,
            default=str,
        ))
        return 0

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    with connect(args.database_url) as conn:
        if args.command == "load-state":
            state_abbr = args.state.upper()
            fips = STATE_ABBR_TO_FIPS.get(state_abbr)
            if not fips:
                parser.error(f"Unknown state abbreviation: {state_abbr}")
            import_batch_id = (
                f"{FARS_KEY}-{state_abbr}-{args.year}-"
                f"{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
            )
            result = load_fars_state(
                conn,
                state_fips=fips,
                year=args.year,
                import_batch_id=import_batch_id,
            )
            print(json.dumps(result, indent=2, default=str))

        elif args.command == "load-year":
            result = load_fars_year(conn, year=args.year)
            print(json.dumps(result, indent=2, default=str))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
