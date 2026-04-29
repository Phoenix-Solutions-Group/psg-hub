#!/usr/bin/env python3
"""Load NOAA storm events and derive ZIP/month demand aggregates."""

from __future__ import annotations

import argparse
import csv
import gzip
import html
import io
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from urllib.request import urlopen

from storm_sources import CANONICAL_STORM_SOURCE_KEY, StormSource, get_storm_source
from supabase_migration import clean_copy_value, connect, copy_rows, execute_sql, sanitize_identifier


NCEI_INDEX_TIMEOUT_SECONDS = 60
NCEI_DETAILS_RE = re.compile(
    r'href="(?P<filename>StormEvents_details-ftp_v1\.0_d(?P<year>\d{4})_c(?P<cycle>\d{8})\.csv\.gz)"'
)

STORM_EVENT_COPY_COLUMNS = [
    "source",
    "source_event_id",
    "episode_id",
    "event_type",
    "event_type_normalized",
    "begin_time",
    "end_time",
    "state",
    "state_fips",
    "source_year",
    "source_month",
    "month_name",
    "cz_type",
    "cz_fips",
    "cz_name",
    "wfo",
    "magnitude",
    "magnitude_type",
    "injuries_direct",
    "injuries_indirect",
    "deaths_direct",
    "deaths_indirect",
    "damage_property_usd",
    "damage_crops_usd",
    "begin_lat",
    "begin_lng",
    "end_lat",
    "end_lng",
    "begin_location",
    "end_location",
    "repair_demand_weight",
    "import_batch_id",
    "raw_payload",
]

STORM_TABLES = {
    "storm_events",
    "storm_event_sources",
    "storm_zip_monthly",
}

HAIL_TYPES = {"hail"}
WIND_TYPES = {"thunderstorm wind", "high wind", "strong wind", "marine thunderstorm wind", "marine high wind"}
TORNADO_TYPES = {"tornado", "waterspout"}
HURRICANE_TROPICAL_TYPES = {
    "hurricane",
    "hurricane (typhoon)",
    "tropical storm",
    "tropical depression",
    "storm surge/tide",
}
FLOOD_TYPES = {"flood", "flash flood", "coastal flood", "lakeshore flood"}
LIGHTNING_TYPES = {"lightning"}
WINTER_TYPES = {
    "winter storm",
    "winter weather",
    "ice storm",
    "heavy snow",
    "blizzard",
    "lake-effect snow",
    "sleet",
    "freezing fog",
    "frost/freeze",
}


@dataclass(frozen=True)
class StormFile:
    family: str
    year: int
    cycle: str
    filename: str
    url: str


def normalize_event_type(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def event_type_bucket(event_type: Any) -> str:
    normalized = normalize_event_type(event_type)
    if normalized in HAIL_TYPES:
        return "hail"
    if normalized in TORNADO_TYPES:
        return "tornado"
    if normalized in WIND_TYPES:
        return "wind"
    if normalized in HURRICANE_TROPICAL_TYPES:
        return "hurricane_tropical"
    if normalized in FLOOD_TYPES:
        return "flood"
    if normalized in LIGHTNING_TYPES:
        return "lightning"
    if normalized in WINTER_TYPES:
        return "winter"
    return "other"


def repair_demand_weight(event_type: Any) -> Decimal:
    bucket = event_type_bucket(event_type)
    weights = {
        "hail": Decimal("5.0"),
        "tornado": Decimal("4.5"),
        "wind": Decimal("4.0"),
        "hurricane_tropical": Decimal("3.0"),
        "flood": Decimal("2.5"),
        "winter": Decimal("2.0"),
        "lightning": Decimal("2.0"),
        "other": Decimal("1.0"),
    }
    return weights[bucket]


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
        numeric = Decimal(str(value).strip())
    except InvalidOperation:
        return None
    if numeric.is_nan() or numeric.is_infinite():
        return None
    return numeric


def parse_damage_usd(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    text = str(value).strip().upper().replace(",", "")
    if text in {"", "UNK", "UNKNOWN", "?"}:
        return None
    multiplier = Decimal("1")
    if text.endswith("K"):
        multiplier = Decimal("1000")
        text = text[:-1]
    elif text.endswith("M"):
        multiplier = Decimal("1000000")
        text = text[:-1]
    elif text.endswith("B"):
        multiplier = Decimal("1000000000")
        text = text[:-1]
    try:
        return Decimal(text) * multiplier
    except InvalidOperation:
        return None


def parse_ncei_timestamp(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    formats = (
        "%d-%b-%y %H:%M:%S",
        "%d-%b-%y %H:%M",
        "%d-%b-%Y %H:%M:%S",
        "%d-%b-%Y %H:%M",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y %H:%M",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).isoformat()
        except ValueError:
            continue
    return text


def build_point_wkt(lat: Any, lng: Any) -> str | None:
    latitude = parse_decimal(lat)
    longitude = parse_decimal(lng)
    if latitude is None or longitude is None:
        return None
    lat_float = float(latitude)
    lng_float = float(longitude)
    if not (24.0 <= lat_float <= 72.0 and -180.0 <= lng_float <= -60.0):
        return None
    return f"SRID=4326;POINT({lng_float} {lat_float})"


def prepare_storm_event_record(
    row: dict[str, Any],
    *,
    source_key: str = CANONICAL_STORM_SOURCE_KEY,
    source_year: int | None = None,
    import_batch_id: str | None = None,
) -> dict[str, Any]:
    raw_payload = {key: clean_copy_value(value) for key, value in row.items()}
    event_type = str(row.get("EVENT_TYPE") or "").strip()
    begin_lat = parse_decimal(row.get("BEGIN_LAT"))
    begin_lng = parse_decimal(row.get("BEGIN_LON"))
    end_lat = parse_decimal(row.get("END_LAT"))
    end_lng = parse_decimal(row.get("END_LON"))

    prepared = {
        "source": source_key,
        "source_event_id": parse_int(row.get("EVENT_ID")),
        "episode_id": parse_int(row.get("EPISODE_ID")),
        "event_type": event_type,
        "event_type_normalized": normalize_event_type(event_type),
        "begin_time": parse_ncei_timestamp(row.get("BEGIN_DATE_TIME")),
        "end_time": parse_ncei_timestamp(row.get("END_DATE_TIME")),
        "state": str(row.get("STATE") or "").strip().upper() or None,
        "state_fips": str(row.get("STATE_FIPS") or "").strip().zfill(2) or None,
        "source_year": source_year or parse_int(row.get("YEAR")),
        "source_month": parse_int(row.get("BEGIN_YEARMONTH")) % 100 if parse_int(row.get("BEGIN_YEARMONTH")) else None,
        "month_name": str(row.get("MONTH_NAME") or "").strip() or None,
        "cz_type": str(row.get("CZ_TYPE") or "").strip() or None,
        "cz_fips": str(row.get("CZ_FIPS") or "").strip().zfill(3) if row.get("CZ_FIPS") not in (None, "") else None,
        "cz_name": str(row.get("CZ_NAME") or "").strip() or None,
        "wfo": str(row.get("WFO") or "").strip() or None,
        "magnitude": parse_decimal(row.get("MAGNITUDE")),
        "magnitude_type": str(row.get("MAGNITUDE_TYPE") or "").strip() or None,
        "injuries_direct": parse_int(row.get("INJURIES_DIRECT")),
        "injuries_indirect": parse_int(row.get("INJURIES_INDIRECT")),
        "deaths_direct": parse_int(row.get("DEATHS_DIRECT")),
        "deaths_indirect": parse_int(row.get("DEATHS_INDIRECT")),
        "damage_property_usd": parse_damage_usd(row.get("DAMAGE_PROPERTY")),
        "damage_crops_usd": parse_damage_usd(row.get("DAMAGE_CROPS")),
        "begin_lat": begin_lat,
        "begin_lng": begin_lng,
        "end_lat": end_lat,
        "end_lng": end_lng,
        "begin_location": build_point_wkt(begin_lat, begin_lng),
        "end_location": build_point_wkt(end_lat, end_lng),
        "repair_demand_weight": repair_demand_weight(event_type),
        "import_batch_id": import_batch_id,
        "raw_payload": json.dumps(raw_payload, sort_keys=True, default=str, allow_nan=False),
    }
    return prepared


def storm_source_metadata(source: StormSource) -> dict[str, Any]:
    return asdict(source)


def parse_ncei_details_index(html_text: str, source: StormSource | None = None) -> list[StormFile]:
    source = source or get_storm_source()
    files: list[StormFile] = []
    for match in NCEI_DETAILS_RE.finditer(html_text):
        filename = html.unescape(match.group("filename"))
        files.append(
            StormFile(
                family="details",
                year=int(match.group("year")),
                cycle=match.group("cycle"),
                filename=filename,
                url=f"{source.bulk_csv_base_url}{filename}",
            )
        )
    return files


def latest_detail_files(files: Iterable[StormFile]) -> dict[int, StormFile]:
    latest: dict[int, StormFile] = {}
    for file in files:
        current = latest.get(file.year)
        if current is None or file.cycle > current.cycle:
            latest[file.year] = file
    return latest


def fetch_ncei_index(source: StormSource) -> str:
    with urlopen(source.bulk_csv_base_url, timeout=NCEI_INDEX_TIMEOUT_SECONDS) as response:
        return response.read().decode("utf-8", errors="replace")


def resolve_detail_files(
    source: StormSource,
    *,
    start_year: int,
    end_year: int,
    index_html: str | None = None,
) -> list[StormFile]:
    index_html = index_html if index_html is not None else fetch_ncei_index(source)
    by_year = latest_detail_files(parse_ncei_details_index(index_html, source))
    missing = [year for year in range(start_year, end_year + 1) if year not in by_year]
    if missing:
        raise RuntimeError(f"NCEI details files missing for years: {missing}")
    return [by_year[year] for year in range(start_year, end_year + 1)]


def iter_ncei_csv_rows(file: StormFile) -> Iterable[dict[str, Any]]:
    with urlopen(file.url, timeout=NCEI_INDEX_TIMEOUT_SECONDS) as response:
        with gzip.GzipFile(fileobj=response) as compressed:
            text_stream = io.TextIOWrapper(compressed, encoding="utf-8", newline="")
            yield from csv.DictReader(text_stream)


def chunked(iterable: Iterable[dict[str, Any]], batch_size: int) -> Iterable[list[dict[str, Any]]]:
    batch: list[dict[str, Any]] = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def copy_storm_event_rows(conn, records: list[dict[str, Any]]) -> int:
    conn.execute("CREATE TEMP TABLE storm_events_stage (LIKE storm_events INCLUDING DEFAULTS) ON COMMIT DROP;")
    rows = ([record.get(column) for column in STORM_EVENT_COPY_COLUMNS] for record in records)
    copied = copy_rows(conn, "storm_events_stage", STORM_EVENT_COPY_COLUMNS, rows)
    columns = ", ".join(STORM_EVENT_COPY_COLUMNS)
    update_columns = ", ".join(
        f"{sanitize_identifier(column)} = EXCLUDED.{sanitize_identifier(column)}"
        for column in STORM_EVENT_COPY_COLUMNS
        if column not in {"source", "source_event_id"}
    )
    conn.execute(
        f"""
        INSERT INTO storm_events ({columns})
        SELECT {columns}
        FROM storm_events_stage
        WHERE source_event_id IS NOT NULL
        ON CONFLICT (source, source_event_id)
        DO UPDATE SET {update_columns}, imported_at = NOW()
        """
    )
    return copied


def record_storm_event_source(
    conn,
    source: StormSource,
    *,
    file: StormFile,
    status: str,
    row_count: int,
    import_batch_id: str,
    notes: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO storm_event_sources (
          source_key,
          source_url,
          file_family,
          source_year,
          cycle,
          file_url,
          row_count,
          status,
          import_batch_id,
          notes
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (source_key, file_family, source_year, cycle)
        DO UPDATE SET
          row_count = EXCLUDED.row_count,
          status = EXCLUDED.status,
          import_batch_id = EXCLUDED.import_batch_id,
          file_url = EXCLUDED.file_url,
          notes = EXCLUDED.notes,
          imported_at = NOW()
        """,
        (
            source.key,
            source.source_url,
            file.family,
            file.year,
            file.cycle,
            file.url,
            row_count,
            status,
            import_batch_id,
            notes,
        ),
    )


def load_ncei_details(
    conn,
    *,
    source_key: str = CANONICAL_STORM_SOURCE_KEY,
    start_year: int,
    end_year: int,
    batch_size: int = 10_000,
    replace: bool = False,
) -> dict[str, Any]:
    source = get_storm_source(source_key)
    files = resolve_detail_files(source, start_year=start_year, end_year=end_year)
    import_batch_id = f"{source.key}-{start_year}-{end_year}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

    if replace:
        conn.execute(
            """
            DELETE FROM storm_events
            WHERE source = %s
              AND source_year BETWEEN %s AND %s
            """,
            (source.key, start_year, end_year),
        )
        conn.commit()

    total_rows = 0
    loaded_by_year: dict[int, int] = {}
    for file in files:
        year_count = 0
        for batch in chunked(iter_ncei_csv_rows(file), batch_size):
            records = [
                prepare_storm_event_record(
                    row,
                    source_key=source.key,
                    source_year=file.year,
                    import_batch_id=import_batch_id,
                )
                for row in batch
            ]
            year_count += copy_storm_event_rows(conn, records)
            conn.commit()
            print(f"{source.key} {file.year}: {year_count} rows", file=sys.stderr, flush=True)
        total_rows += year_count
        loaded_by_year[file.year] = year_count
        record_storm_event_source(
            conn,
            source,
            file=file,
            status="loaded",
            row_count=year_count,
            import_batch_id=import_batch_id,
        )
        conn.commit()

    return {
        "source": storm_source_metadata(source),
        "import_batch_id": import_batch_id,
        "loaded_rows": total_rows,
        "loaded_by_year": loaded_by_year,
    }


def storm_zip_monthly_refresh_sql(start_year: int, end_year: int) -> str:
    start = f"{start_year:04d}-01-01"
    end = f"{end_year + 1:04d}-01-01"
    return f"""
DELETE FROM storm_zip_monthly
WHERE month >= DATE '{start}' AND month < DATE '{end}';

INSERT INTO storm_zip_monthly (
  zip,
  month,
  state,
  total_events,
  hail_events,
  wind_events,
  tornado_events,
  flood_events,
  hurricane_tropical_events,
  lightning_events,
  winter_storm_events,
  high_wind_events,
  weighted_storm_demand_score,
  max_hail_size,
  max_wind_speed,
  property_damage_usd,
  unmatched_event_count,
  fallback_event_count
)
WITH matched_events AS (
  SELECT DISTINCT ON (se.id)
    se.id,
    zb.zip_code AS zip,
    DATE_TRUNC('month', se.begin_time)::date AS month,
    se.state,
    se.event_type_normalized,
    se.magnitude,
    se.damage_property_usd,
    se.repair_demand_weight
  FROM storm_events se
  JOIN zipcode_boundaries zb
    ON zb.boundary IS NOT NULL
   AND se.begin_location IS NOT NULL
   AND ST_Covers(zb.boundary, se.begin_location::geometry)
  WHERE se.begin_time >= TIMESTAMPTZ '{start}'
    AND se.begin_time < TIMESTAMPTZ '{end}'
  ORDER BY se.id, zb.zip_code
)
SELECT
  zip,
  month,
  MAX(state) AS state,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE event_type_normalized = 'hail') AS hail_events,
  COUNT(*) FILTER (WHERE event_type_normalized IN ('thunderstorm wind', 'high wind', 'strong wind', 'marine thunderstorm wind', 'marine high wind')) AS wind_events,
  COUNT(*) FILTER (WHERE event_type_normalized IN ('tornado', 'waterspout')) AS tornado_events,
  COUNT(*) FILTER (WHERE event_type_normalized IN ('flood', 'flash flood', 'coastal flood', 'lakeshore flood')) AS flood_events,
  COUNT(*) FILTER (WHERE event_type_normalized IN ('hurricane', 'hurricane (typhoon)', 'tropical storm', 'tropical depression', 'storm surge/tide')) AS hurricane_tropical_events,
  COUNT(*) FILTER (WHERE event_type_normalized = 'lightning') AS lightning_events,
  COUNT(*) FILTER (WHERE event_type_normalized IN ('winter storm', 'winter weather', 'ice storm', 'heavy snow', 'blizzard', 'lake-effect snow', 'sleet', 'freezing fog', 'frost/freeze')) AS winter_storm_events,
  COUNT(*) FILTER (WHERE event_type_normalized IN ('high wind', 'strong wind', 'marine high wind')) AS high_wind_events,
  ROUND(SUM(repair_demand_weight)::numeric, 2) AS weighted_storm_demand_score,
  MAX(magnitude) FILTER (WHERE event_type_normalized = 'hail') AS max_hail_size,
  MAX(magnitude) FILTER (WHERE event_type_normalized IN ('thunderstorm wind', 'high wind', 'strong wind', 'marine thunderstorm wind', 'marine high wind')) AS max_wind_speed,
  COALESCE(SUM(damage_property_usd), 0) AS property_damage_usd,
  0 AS unmatched_event_count,
  0 AS fallback_event_count
FROM matched_events
GROUP BY zip, month;

INSERT INTO storm_zip_monthly (
  zip,
  month,
  state,
  total_events,
  hail_events,
  wind_events,
  tornado_events,
  flood_events,
  hurricane_tropical_events,
  lightning_events,
  winter_storm_events,
  high_wind_events,
  weighted_storm_demand_score,
  property_damage_usd,
  unmatched_event_count,
  fallback_event_count
)
SELECT
  '__UNMATCHED__' AS zip,
  DATE_TRUNC('month', se.begin_time)::date AS month,
  NULL::text AS state,
  0 AS total_events,
  0 AS hail_events,
  0 AS wind_events,
  0 AS tornado_events,
  0 AS flood_events,
  0 AS hurricane_tropical_events,
  0 AS lightning_events,
  0 AS winter_storm_events,
  0 AS high_wind_events,
  0 AS weighted_storm_demand_score,
  0 AS property_damage_usd,
  COUNT(*) AS unmatched_event_count,
  0 AS fallback_event_count
FROM storm_events se
WHERE se.begin_time >= TIMESTAMPTZ '{start}'
  AND se.begin_time < TIMESTAMPTZ '{end}'
  AND (
    se.begin_location IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM zipcode_boundaries zb
      WHERE zb.boundary IS NOT NULL
        AND ST_Covers(zb.boundary, se.begin_location::geometry)
    )
  )
GROUP BY DATE_TRUNC('month', se.begin_time)::date;
"""


def refresh_zip_monthly(conn, *, start_year: int, end_year: int) -> None:
    execute_sql(conn, storm_zip_monthly_refresh_sql(start_year, end_year))
    conn.commit()


def point_in_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    j = len(ring) - 1
    for i, point in enumerate(ring):
        xi, yi = point[0], point[1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / (yj - yi + sys.float_info.epsilon) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_geojson(lng: float, lat: float, geometry: dict[str, Any]) -> bool:
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    polygons = [coordinates] if geometry_type == "Polygon" else []
    if geometry_type == "MultiPolygon":
        polygons = coordinates
    for polygon in polygons:
        outer = polygon[0] if polygon else []
        holes = polygon[1:] if len(polygon) > 1 else []
        if point_in_ring(lng, lat, outer) and not any(point_in_ring(lng, lat, hole) for hole in holes):
            return True
    return False


def assign_event_zip(event: dict[str, Any], boundaries: Iterable[dict[str, Any]]) -> str | None:
    lat = event.get("begin_lat")
    lng = event.get("begin_lng")
    if lat in (None, "") or lng in (None, ""):
        return None
    lat_float = float(lat)
    lng_float = float(lng)
    for boundary in boundaries:
        geometry = boundary.get("geometry") or boundary.get("boundary_geojson")
        if isinstance(geometry, str):
            geometry = json.loads(geometry)
        if geometry and point_in_geojson(lng_float, lat_float, geometry):
            return str(boundary["zip_code"])
    return None


def inspect_source(source_key: str, *, start_year: int | None = None, end_year: int | None = None) -> dict[str, Any]:
    source = get_storm_source(source_key)
    index_html = fetch_ncei_index(source)
    files = latest_detail_files(parse_ncei_details_index(index_html, source))
    years = sorted(files)
    selected_years = years
    if start_year is not None:
        selected_years = [year for year in selected_years if year >= start_year]
    if end_year is not None:
        selected_years = [year for year in selected_years if year <= end_year]
    return {
        "source": storm_source_metadata(source),
        "available_detail_years": years,
        "selected_detail_files": [asdict(files[year]) for year in selected_years],
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
    inspect.add_argument("--source", default=CANONICAL_STORM_SOURCE_KEY)
    inspect.add_argument("--start-year", type=int)
    inspect.add_argument("--end-year", type=int)

    load = subcommands.add_parser("load-ncei")
    load.add_argument("--source", default=CANONICAL_STORM_SOURCE_KEY)
    load.add_argument("--start-year", type=int, required=True)
    load.add_argument("--end-year", type=int, required=True)
    load.add_argument("--batch-size", type=int, default=10_000)
    load.add_argument("--replace", action="store_true")

    refresh = subcommands.add_parser("refresh-zip-monthly")
    refresh.add_argument("--start-year", type=int, required=True)
    refresh.add_argument("--end-year", type=int, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "inspect-source":
        result = inspect_source(args.source, start_year=args.start_year, end_year=args.end_year)
        print(json.dumps(result, indent=2, default=str))
        return 0

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    with connect(args.database_url) as conn:
        if args.command == "load-ncei":
            result = load_ncei_details(
                conn,
                source_key=args.source,
                start_year=args.start_year,
                end_year=args.end_year,
                batch_size=args.batch_size,
                replace=args.replace,
            )
            print(json.dumps(result, indent=2, default=str))
        elif args.command == "refresh-zip-monthly":
            refresh_zip_monthly(conn, start_year=args.start_year, end_year=args.end_year)
            print(f"refreshed storm_zip_monthly for {args.start_year}-{args.end_year}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
