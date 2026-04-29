#!/usr/bin/env python3
"""Load official crash event sources and aggregate annual ZIP demand."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.request import urlopen

from crash_sources import CHICAGO_TRAFFIC_CRASHES_KEY, CrashSource, get_crash_source, prioritized_crash_sources
from supabase_migration import clean_copy_value, connect, copy_rows


CHICAGO_API_LIMIT = 50_000

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
    except ValueError:
        return None


def parse_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        value_decimal = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    if value_decimal.is_nan() or value_decimal.is_infinite():
        return None
    return value_decimal


def parse_timestamp(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if text.endswith(".000"):
        text = text[:-4]
    return text


def build_location_wkt(latitude: Any, longitude: Any) -> str | None:
    lat = parse_decimal(latitude)
    lng = parse_decimal(longitude)
    if lat is None or lng is None:
        return None
    lat_float = float(lat)
    lng_float = float(lng)
    if not (24.0 <= lat_float <= 72.0 and -180.0 <= lng_float <= -60.0):
        return None
    return f"SRID=4326;POINT({lng_float} {lat_float})"


def chicago_severity(row: dict[str, Any]) -> str:
    if parse_int(row.get("injuries_fatal")):
        return "fatal"
    if parse_int(row.get("injuries_incapacitating")):
        return "serious_injury"
    if parse_int(row.get("injuries_total")):
        return "injury"
    crash_type = str(row.get("crash_type") or "").lower()
    if "tow" in crash_type:
        return "tow_or_injury"
    return "property_damage"


def prepare_chicago_crash_record(
    row: dict[str, Any],
    *,
    import_batch_id: str | None = None,
) -> dict[str, Any]:
    raw_payload = {key: clean_copy_value(value) for key, value in row.items()}
    latitude = parse_decimal(row.get("latitude"))
    longitude = parse_decimal(row.get("longitude"))
    event_time = parse_timestamp(row.get("crash_date"))
    reported_time = parse_timestamp(row.get("date_police_notified"))
    has_location = latitude is not None and longitude is not None
    prepared = {
        "source": CHICAGO_TRAFFIC_CRASHES_KEY,
        "source_event_id": str(row.get("crash_record_id") or "").strip(),
        "event_time": event_time,
        "reported_time": reported_time,
        "state": "IL",
        "city": "Chicago",
        "latitude": latitude,
        "longitude": longitude,
        "location": build_location_wkt(latitude, longitude),
        "severity": chicago_severity(row),
        "fatalities": parse_int(row.get("injuries_fatal")),
        "injuries_total": parse_int(row.get("injuries_total")),
        "injuries_incapacitating": parse_int(row.get("injuries_incapacitating")),
        "vehicles_involved": parse_int(row.get("num_units")),
        "damage": str(row.get("damage") or "").strip() or None,
        "weather_condition": str(row.get("weather_condition") or "").strip() or None,
        "roadway_surface_condition": str(row.get("roadway_surface_cond") or "").strip() or None,
        "collision_type": str(row.get("first_crash_type") or "").strip() or None,
        "primary_contributory_cause": str(row.get("prim_contributory_cause") or "").strip() or None,
        "source_lag_days": None,
        "confidence_score": Decimal("0.95") if has_location else Decimal("0.70"),
        "import_batch_id": import_batch_id,
        "raw_payload": json.dumps(raw_payload, sort_keys=True, default=str, allow_nan=False),
    }
    return prepared


def crash_source_metadata(source: CrashSource) -> dict[str, Any]:
    return asdict(source)


def chicago_api_url(*, start_year: int, end_year: int, limit: int, offset: int) -> str:
    source = get_crash_source(CHICAGO_TRAFFIC_CRASHES_KEY)
    where = (
        f"crash_date >= '{start_year}-01-01T00:00:00' "
        f"AND crash_date < '{end_year + 1}-01-01T00:00:00'"
    )
    select = ",".join([
        "crash_record_id",
        "crash_date",
        "date_police_notified",
        "crash_type",
        "damage",
        "weather_condition",
        "roadway_surface_cond",
        "first_crash_type",
        "prim_contributory_cause",
        "num_units",
        "most_severe_injury",
        "injuries_total",
        "injuries_fatal",
        "injuries_incapacitating",
        "latitude",
        "longitude",
    ])
    params = urlencode({
        "$select": select,
        "$where": where,
        "$order": "crash_date,crash_record_id",
        "$limit": str(limit),
        "$offset": str(offset),
    })
    return f"{source.api_url}?{params}"


def fetch_chicago_batch(*, start_year: int, end_year: int, limit: int, offset: int) -> list[dict[str, Any]]:
    with urlopen(chicago_api_url(start_year=start_year, end_year=end_year, limit=limit, offset=offset), timeout=120) as response:
        return json.load(response)


def iter_chicago_crashes(*, start_year: int, end_year: int, batch_size: int = CHICAGO_API_LIMIT) -> Iterable[list[dict[str, Any]]]:
    offset = 0
    while True:
        batch = fetch_chicago_batch(start_year=start_year, end_year=end_year, limit=batch_size, offset=offset)
        if not batch:
            return
        yield batch
        if len(batch) < batch_size:
            return
        offset += batch_size


def copy_crash_event_rows(conn, records: list[dict[str, Any]]) -> int:
    conn.execute("CREATE TEMP TABLE crash_events_stage (LIKE crash_events INCLUDING DEFAULTS) ON COMMIT DROP;")
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


def record_crash_event_source(
    conn,
    source: CrashSource,
    *,
    source_year: int,
    row_count: int,
    status: str,
    import_batch_id: str,
    notes: str | None = None,
) -> None:
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
            source.geography,
            source_year,
            row_count,
            status,
            import_batch_id,
            notes,
        ),
    )


def load_chicago_crashes(conn, *, start_year: int, end_year: int, batch_size: int = CHICAGO_API_LIMIT) -> dict[str, Any]:
    source = get_crash_source(CHICAGO_TRAFFIC_CRASHES_KEY)
    import_batch_id = f"{source.key}-{start_year}-{end_year}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    loaded_by_year: dict[int, int] = {}
    total_loaded = 0
    for year in range(start_year, end_year + 1):
        year_loaded = 0
        for batch in iter_chicago_crashes(start_year=year, end_year=year, batch_size=batch_size):
            records = [
                prepare_chicago_crash_record(row, import_batch_id=import_batch_id)
                for row in batch
            ]
            year_loaded += copy_crash_event_rows(conn, records)
            conn.commit()
            print(f"{source.key} {year}: {year_loaded} rows", file=sys.stderr, flush=True)
        loaded_by_year[year] = year_loaded
        total_loaded += year_loaded
        record_crash_event_source(
            conn,
            source,
            source_year=year,
            row_count=year_loaded,
            status="loaded",
            import_batch_id=import_batch_id,
        )
        conn.commit()
    return {
        "source": crash_source_metadata(source),
        "import_batch_id": import_batch_id,
        "loaded_rows": total_loaded,
        "loaded_by_year": loaded_by_year,
    }


def crash_zip_annual_refresh_sql(start_year: int, end_year: int) -> str:
    return f"""
DELETE FROM crash_zip_annual
WHERE source = '{CHICAGO_TRAFFIC_CRASHES_KEY}'
  AND year BETWEEN {start_year} AND {end_year};

INSERT INTO crash_zip_annual (
  source,
  zip,
  state,
  city,
  year,
  total_crashes,
  fatal_crashes,
  injury_crashes,
  tow_or_injury_crashes,
  property_damage_crashes,
  weather_related_crashes,
  weighted_crash_demand_score,
  unmatched_crash_count
)
WITH matched AS (
  SELECT DISTINCT ON (ce.id)
    ce.id,
    zb.zip_code AS zip,
    ce.state,
    ce.city,
    EXTRACT(YEAR FROM ce.event_time)::integer AS year,
    ce.severity,
    ce.weather_condition,
    CASE
      WHEN ce.severity = 'fatal' THEN 8.0
      WHEN ce.severity = 'serious_injury' THEN 5.0
      WHEN ce.severity = 'injury' THEN 3.0
      WHEN ce.severity = 'tow_or_injury' THEN 2.0
      ELSE 1.0
    END AS demand_weight
  FROM crash_events ce
  JOIN zipcode_boundaries zb
    ON zb.boundary IS NOT NULL
   AND ce.location IS NOT NULL
   AND ST_Covers(zb.boundary, ce.location::geometry)
  WHERE ce.source = '{CHICAGO_TRAFFIC_CRASHES_KEY}'
    AND ce.event_time >= TIMESTAMPTZ '{start_year}-01-01'
    AND ce.event_time < TIMESTAMPTZ '{end_year + 1}-01-01'
  ORDER BY ce.id, zb.zip_code
),
unmatched AS (
  SELECT
    EXTRACT(YEAR FROM ce.event_time)::integer AS year,
    COUNT(*) AS unmatched_count
  FROM crash_events ce
  WHERE ce.source = '{CHICAGO_TRAFFIC_CRASHES_KEY}'
    AND ce.event_time >= TIMESTAMPTZ '{start_year}-01-01'
    AND ce.event_time < TIMESTAMPTZ '{end_year + 1}-01-01'
    AND (
      ce.location IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM zipcode_boundaries zb
        WHERE zb.boundary IS NOT NULL
          AND ST_Covers(zb.boundary, ce.location::geometry)
      )
    )
  GROUP BY EXTRACT(YEAR FROM ce.event_time)::integer
)
SELECT
  '{CHICAGO_TRAFFIC_CRASHES_KEY}' AS source,
  zip,
  MAX(state) AS state,
  MAX(city) AS city,
  year,
  COUNT(*) AS total_crashes,
  COUNT(*) FILTER (WHERE severity = 'fatal') AS fatal_crashes,
  COUNT(*) FILTER (WHERE severity IN ('fatal', 'serious_injury', 'injury')) AS injury_crashes,
  COUNT(*) FILTER (WHERE severity IN ('fatal', 'serious_injury', 'injury', 'tow_or_injury')) AS tow_or_injury_crashes,
  COUNT(*) FILTER (WHERE severity = 'property_damage') AS property_damage_crashes,
  COUNT(*) FILTER (
    WHERE LOWER(COALESCE(weather_condition, '')) ~ 'rain|snow|ice|fog|sleet|hail|storm|freezing|wet'
  ) AS weather_related_crashes,
  ROUND(SUM(demand_weight)::numeric, 2) AS weighted_crash_demand_score,
  0 AS unmatched_crash_count
FROM matched
GROUP BY zip, year
UNION ALL
SELECT
  '{CHICAGO_TRAFFIC_CRASHES_KEY}' AS source,
  '__UNMATCHED__' AS zip,
  'IL' AS state,
  'Chicago' AS city,
  year,
  0 AS total_crashes,
  0 AS fatal_crashes,
  0 AS injury_crashes,
  0 AS tow_or_injury_crashes,
  0 AS property_damage_crashes,
  0 AS weather_related_crashes,
  0 AS weighted_crash_demand_score,
  unmatched_count AS unmatched_crash_count
FROM unmatched;
"""


def refresh_crash_zip_annual(conn, *, start_year: int, end_year: int) -> None:
    conn.execute(crash_zip_annual_refresh_sql(start_year, end_year))
    conn.commit()


def inspect_chicago_source(start_year: int, end_year: int) -> dict[str, Any]:
    counts: dict[int, int] = {}
    for year in range(start_year, end_year + 1):
        params = urlencode({
            "$select": "count(*)",
            "$where": (
                f"crash_date >= '{year}-01-01T00:00:00' "
                f"AND crash_date < '{year + 1}-01-01T00:00:00'"
            ),
        })
        with urlopen(f"{get_crash_source().api_url}?{params}", timeout=60) as response:
            rows = json.load(response)
        counts[year] = int(rows[0]["count"]) if rows else 0
    return {
        "source": crash_source_metadata(get_crash_source()),
        "annual_counts": counts,
    }


def inspect_crash_sources() -> dict[str, Any]:
    return {
        "sources": [crash_source_metadata(source) for source in prioritized_crash_sources()],
        "next_recommended_source": crash_source_metadata(prioritized_crash_sources()[0]),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    subcommands.add_parser("inspect-sources")

    inspect = subcommands.add_parser("inspect-chicago-source")
    inspect.add_argument("--start-year", type=int, required=True)
    inspect.add_argument("--end-year", type=int, required=True)

    load = subcommands.add_parser("load-chicago")
    load.add_argument("--start-year", type=int, required=True)
    load.add_argument("--end-year", type=int, required=True)
    load.add_argument("--batch-size", type=int, default=CHICAGO_API_LIMIT)

    refresh = subcommands.add_parser("refresh-zip-annual")
    refresh.add_argument("--start-year", type=int, required=True)
    refresh.add_argument("--end-year", type=int, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "inspect-sources":
        print(json.dumps(inspect_crash_sources(), indent=2, default=str))
        return 0
    if args.command == "inspect-chicago-source":
        print(json.dumps(inspect_chicago_source(args.start_year, args.end_year), indent=2, default=str))
        return 0
    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")
    with connect(args.database_url) as conn:
        if args.command == "load-chicago":
            print(json.dumps(
                load_chicago_crashes(
                    conn,
                    start_year=args.start_year,
                    end_year=args.end_year,
                    batch_size=args.batch_size,
                ),
                indent=2,
                default=str,
            ))
        elif args.command == "refresh-zip-annual":
            refresh_crash_zip_annual(conn, start_year=args.start_year, end_year=args.end_year)
            print(f"refreshed crash_zip_annual for {args.start_year}-{args.end_year}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
