#!/usr/bin/env python3
"""Offline tooling for migrating PSG BigQuery exports into Supabase.

This script creates reviewable, repeatable steps for a human-run migration. It
does not export from BigQuery or mutate Supabase unless explicitly invoked with
a DATABASE_URL and a subcommand.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from accident_sources import (
    CANONICAL_ACCIDENT_SOURCE_KEY,
    AccidentSource,
    get_accident_source,
)
from load_accidents import sanitize_column_name
from utils.normalize import normalize_zip


KNOWN_TABLES = {
    "survey_responses",
    "body_shops",
    "state_references",
    "county_references",
    "zip_references",
    "zcta_zip_mapping",
    "accidents",
    "zipcode_boundaries",
    "accident_density",
    "accident_import_sources",
    "storm_events",
    "storm_event_sources",
    "storm_zip_monthly",
    "storm_events_stage",
    "crash_events",
    "crash_event_sources",
    "crash_zip_annual",
    "crash_events_stage",
    "ev_registrations",
    "state_vehicle_registrations",
    "zcta_vehicle_availability",
    "estimated_zip_vehicles",
    "county_vehicle_registrations",
}

KNOWN_RELATIONS = KNOWN_TABLES | {
    "sensitive.survey_pii",
    "sensitive.repair_customers",
    "sensitive.repair_customer_locations",
}

ACCIDENT_SAMPLE_IDS = ["A-1", "A-2", "A-3", "A-10", "A-100", "A-1000"]
PUBLIC_SURVEY_RAW_PAYLOAD_REDACT_KEYS = {
    "sq_referral_agent",
    "text_customer_comments",
}

CORE_BIGQUERY_TRANSFERS = [
    {
        "name": "state_references",
        "table": "state_references",
        "columns": ["state_fips", "state_abbr", "state_name"],
        "sql": """
            SELECT state_fips, state_abbr, state_name
            FROM `n8n-workspace-apis.psg_geo_data.state_reference`
        """,
    },
    {
        "name": "county_references",
        "table": "county_references",
        "columns": ["county_fips", "state_abbr", "county_name", "state_fips"],
        "sql": """
            SELECT county_fips, state_abbr, county_name, state_fips
            FROM `n8n-workspace-apis.psg_geo_data.county_reference`
        """,
    },
    {
        "name": "zip_references",
        "table": "zip_references",
        "columns": ["zip_code", "state_fips", "county_fips"],
        "sql": """
            SELECT zip_code, state_fips, county_fips
            FROM `n8n-workspace-apis.psg_geo_data.zip_reference`
        """,
    },
    {
        "name": "zcta_zip_mapping",
        "table": "zcta_zip_mapping",
        "columns": [
            "zip_code",
            "reporting_year",
            "zip_type",
            "city_name",
            "state_name",
            "state_abbr",
            "enc_zip",
            "zcta",
        ],
        "sql": """
            SELECT zip_code, reporting_year, zip_type, city_name, state_name, state_abbr, enc_zip, zcta
            FROM `n8n-workspace-apis.psg_geo_data.zcta_zip_mapping`
        """,
    },
    {
        "name": "body_shops",
        "table": "body_shops",
        "columns": [
            "shop_id",
            "shop_name",
            "place_id",
            "address",
            "phone",
            "website",
            "rating",
            "category",
            "latitude",
            "longitude",
            "raw_payload",
        ],
        "sql": """
            SELECT
              COALESCE(place_id, TO_HEX(MD5(CONCAT(COALESCE(name, ''), '|', COALESCE(address, ''))))) AS shop_id,
              COALESCE(name, place_id, 'Unknown shop') AS shop_name,
              place_id,
              address,
              phone,
              website,
              rating,
              category,
              latitude,
              longitude,
              TO_JSON_STRING(t) AS raw_payload
            FROM `n8n-workspace-apis.psg_geo_data.us_body_shops` t
        """,
    },
    {
        "name": "survey_responses",
        "table": "survey_responses",
        "json_remove_keys": sorted(PUBLIC_SURVEY_RAW_PAYLOAD_REDACT_KEYS),
        "columns": [
            "shop_name",
            "survey_date",
            "scale_emi_pct",
            "q05_01",
            "q05_02",
            "q05_03",
            "q05_04",
            "text_customer_comments",
            "raw_payload",
        ],
        "sql": """
            SELECT
              COALESCE(shop_name, shop_id, 'Unknown shop') AS shop_name,
              survey_date,
              scale_emi_pct,
              q05_01,
              q05_02,
              q05_03,
              q05_04,
              text_customer_comments,
              TO_JSON_STRING(t) AS raw_payload
            FROM `n8n-workspace-apis.psg_advantage_data.survey_responses` t
            WHERE survey_date IS NOT NULL
        """,
    },
    {
        "name": "zipcode_boundaries",
        "table": "zipcode_boundaries",
        "columns": ["zip_code", "state_fips", "boundary_geojson"],
        "sql": """
            SELECT zip_code, state_fips, ST_ASGEOJSON(boundary_geo) AS boundary_geojson
            FROM `n8n-workspace-apis.psg_geo_data.zipcode_boundaries`
            QUALIFY ROW_NUMBER() OVER (PARTITION BY zip_code ORDER BY state_fips) = 1
        """,
    },
    {
        "name": "accident_density",
        "table": "accident_density",
        "columns": [
            "zip",
            "state",
            "year",
            "severity_1_count",
            "severity_2_count",
            "severity_3_count",
            "severity_4_count",
            "total_count",
            "weather_related_count",
        ],
        "sql": """
            SELECT
              zip,
              ANY_VALUE(state) AS state,
              year,
              SUM(severity_1_count) AS severity_1_count,
              SUM(severity_2_count) AS severity_2_count,
              SUM(severity_3_count) AS severity_3_count,
              SUM(severity_4_count) AS severity_4_count,
              SUM(total_count) AS total_count,
              SUM(weather_related_count) AS weather_related_count
            FROM `n8n-workspace-apis.psg_geo_data.accident_density`
            WHERE year IS NOT NULL
            GROUP BY zip, year
        """,
    },
    {
        "name": "accidents",
        "table": "accidents",
        "columns": [
            "id",
            "source",
            "severity",
            "start_time",
            "end_time",
            "start_lat",
            "start_lng",
            "end_lat",
            "end_lng",
            "location",
            "distance_mi",
            "description",
            "street",
            "city",
            "county",
            "state",
            "zipcode",
            "country",
            "timezone",
            "airport_code",
            "weather_timestamp",
            "temperature_f",
            "wind_chill_f",
            "humidity_pct",
            "pressure_in",
            "visibility_mi",
            "wind_direction",
            "wind_speed_mph",
            "precipitation_in",
            "weather_condition",
            "amenity",
            "bump",
            "crossing",
            "give_way",
            "junction",
            "no_exit",
            "railway",
            "roundabout",
            "station",
            "stop",
            "traffic_calming",
            "traffic_signal",
            "turning_loop",
            "sunrise_sunset",
            "civil_twilight",
            "nautical_twilight",
            "astronomical_twilight",
        ],
        "sql": """
            SELECT
              id,
              source,
              severity,
              start_time,
              end_time,
              start_lat,
              start_lng,
              end_lat,
              end_lng,
              IF(
                start_lat IS NOT NULL
                AND start_lng IS NOT NULL
                AND start_lat BETWEEN 24.0 AND 72.0
                AND start_lng BETWEEN -180.0 AND -60.0,
                CONCAT('SRID=4326;POINT(', CAST(start_lng AS STRING), ' ', CAST(start_lat AS STRING), ')'),
                NULL
              ) AS location,
              distance_mi,
              description,
              street,
              city,
              county,
              state,
              zipcode,
              country,
              timezone,
              airport_code,
              weather_timestamp,
              temperature_f,
              wind_chill_f,
              humidity_pct,
              pressure_in,
              visibility_mi,
              wind_direction,
              wind_speed_mph,
              precipitation_in,
              weather_condition,
              amenity,
              bump,
              crossing,
              give_way,
              junction,
              no_exit,
              railway,
              roundabout,
              station,
              stop,
              traffic_calming,
              traffic_signal,
              turning_loop,
              sunrise_sunset,
              civil_twilight,
              nautical_twilight,
              astronomical_twilight
            FROM `n8n-workspace-apis.psg_geo_data.accidents`
        """,
    },
]

PII_BIGQUERY_TRANSFERS = [
    {
        "name": "survey_pii",
        "table": "sensitive.survey_pii",
        "columns": [
            "response_id",
            "match_key",
            "customer_first_name",
            "customer_last_name",
            "customer_address",
            "customer_address2",
            "customer_city",
            "customer_state",
            "customer_zip",
            "customer_phone_home",
            "customer_phone_mobile",
            "customer_phone_night",
            "agent_first_name",
            "agent_last_name",
            "agent_address",
            "agent_address2",
            "agent_city",
            "agent_state",
            "agent_zip",
            "vehicle_make",
            "vehicle_model",
            "source_loaded_at",
            "raw_payload",
        ],
        "sql": """
            SELECT
              response_id,
              match_key,
              customer_first_name,
              customer_last_name,
              customer_address,
              customer_address2,
              customer_city,
              customer_state,
              customer_zip,
              customer_phone_home,
              customer_phone_mobile,
              customer_phone_night,
              agent_first_name,
              agent_last_name,
              agent_address,
              agent_address2,
              agent_city,
              agent_state,
              agent_zip,
              vehicle_make,
              vehicle_model,
              loaded_at AS source_loaded_at,
              TO_JSON_STRING(t) AS raw_payload
            FROM `n8n-workspace-apis.psg_advantage_data.survey_pii` t
        """,
    },
    {
        "name": "repair_customers",
        "table": "sensitive.repair_customers",
        "columns": [
            "repair_id",
            "match_key",
            "shop_id",
            "shop_name",
            "creation_date",
            "date_in",
            "date_out",
            "ro_number",
            "repair_total",
            "pay_type",
            "insurance_company",
            "vehicle_year",
            "vehicle_make",
            "vehicle_model",
            "customer_first_name",
            "customer_last_name",
            "customer_email",
            "customer_phone",
            "source_platform",
            "survey_sent",
            "survey_sent_date",
            "anomaly_flag",
            "source_loaded_at",
            "raw_payload",
        ],
        "sql": """
            SELECT
              repair_id,
              match_key,
              shop_id,
              shop_name,
              creation_date,
              date_in,
              date_out,
              ro_number,
              repair_total,
              pay_type,
              insurance_company,
              vehicle_year,
              vehicle_make,
              vehicle_model,
              customer_first_name,
              customer_last_name,
              customer_email,
              customer_phone,
              source_platform,
              survey_sent,
              survey_sent_date,
              anomaly_flag,
              loaded_at AS source_loaded_at,
              TO_JSON_STRING(t) AS raw_payload
            FROM `n8n-workspace-apis.psg_advantage_data.repair_customers` t
        """,
    },
]

ACCIDENT_BOOL_COLUMNS = {
    "amenity",
    "bump",
    "crossing",
    "give_way",
    "junction",
    "no_exit",
    "railway",
    "roundabout",
    "station",
    "stop",
    "traffic_calming",
    "traffic_signal",
    "turning_loop",
}

ACCIDENT_NUMERIC_COLUMNS = {
    "severity",
    "start_lat",
    "start_lng",
    "end_lat",
    "end_lng",
    "distance_mi",
    "temperature_f",
    "wind_chill_f",
    "humidity_pct",
    "pressure_in",
    "visibility_mi",
    "wind_speed_mph",
    "precipitation_in",
}

ACCIDENT_COPY_COLUMNS = [
    "id",
    "source",
    "severity",
    "start_time",
    "end_time",
    "start_lat",
    "start_lng",
    "end_lat",
    "end_lng",
    "location",
    "distance_mi",
    "description",
    "street",
    "city",
    "county",
    "state",
    "zipcode",
    "country",
    "timezone",
    "airport_code",
    "weather_timestamp",
    "temperature_f",
    "wind_chill_f",
    "humidity_pct",
    "pressure_in",
    "visibility_mi",
    "wind_direction",
    "wind_speed_mph",
    "precipitation_in",
    "weather_condition",
    "amenity",
    "bump",
    "crossing",
    "give_way",
    "junction",
    "no_exit",
    "railway",
    "roundabout",
    "station",
    "stop",
    "traffic_calming",
    "traffic_signal",
    "turning_loop",
    "sunrise_sunset",
    "civil_twilight",
    "nautical_twilight",
    "astronomical_twilight",
    "import_batch_id",
    "raw_payload",
]

DENSITY_REFRESH_SQL = """
TRUNCATE accident_density;

INSERT INTO accident_density (
  zip,
  state,
  year,
  severity_1_count,
  severity_2_count,
  severity_3_count,
  severity_4_count,
  total_count,
  weather_related_count
)
SELECT
  zipcode AS zip,
  state,
  EXTRACT(YEAR FROM start_time)::integer AS year,
  COUNT(*) FILTER (WHERE severity = 1) AS severity_1_count,
  COUNT(*) FILTER (WHERE severity = 2) AS severity_2_count,
  COUNT(*) FILTER (WHERE severity = 3) AS severity_3_count,
  COUNT(*) FILTER (WHERE severity = 4) AS severity_4_count,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (
    WHERE LOWER(COALESCE(weather_condition, '')) LIKE ANY (
      ARRAY['%rain%', '%snow%', '%fog%', '%ice%', '%sleet%', '%storm%', '%hail%', '%freezing%', '%wintry%', '%blizzard%']
    )
  ) AS weather_related_count
FROM accidents
WHERE zipcode IS NOT NULL
  AND start_time IS NOT NULL
GROUP BY zipcode, state, EXTRACT(YEAR FROM start_time);
"""

SPATIAL_REFRESH_SQL = """
UPDATE accidents
SET location = ST_SetSRID(ST_MakePoint(start_lng, start_lat), 4326)::geography
WHERE start_lat IS NOT NULL
  AND start_lng IS NOT NULL
  AND start_lat BETWEEN 24.0 AND 72.0
  AND start_lng BETWEEN -180.0 AND -60.0
  AND location IS NULL;

UPDATE body_shops
SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND location IS NULL;

UPDATE zipcode_boundaries
SET boundary = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(boundary_geojson::text), 4326))
WHERE boundary IS NULL
  AND boundary_geojson IS NOT NULL;
"""


def sanitize_identifier(value: str) -> str:
    """Return a conservative SQL identifier from a known table or column name."""
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", value):
        raise ValueError(f"Unsafe SQL identifier: {value!r}")
    return value


def sanitize_relation(value: str) -> str:
    """Return a safe table relation, optionally schema-qualified."""
    if value not in KNOWN_RELATIONS:
        raise ValueError(f"Unsupported table: {value}")
    return ".".join(sanitize_identifier(part) for part in value.split("."))


def parse_bool(value: Any) -> bool | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"true", "t", "1", "yes", "y"}:
        return True
    if normalized in {"false", "f", "0", "no", "n"}:
        return False
    return None


def parse_number(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return str(value).strip()


def clean_copy_value(value: Any) -> Any:
    """Normalize pandas/numpy values into psycopg COPY-friendly scalars."""
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def build_location_wkt(row: dict[str, Any]) -> str | None:
    lat = row.get("start_lat")
    lng = row.get("start_lng")
    try:
        lat_float = float(lat)
        lng_float = float(lng)
    except (TypeError, ValueError):
        return None
    if not (24.0 <= lat_float <= 72.0 and -180.0 <= lng_float <= -60.0):
        return None
    return f"SRID=4326;POINT({lng_float} {lat_float})"


def prepare_accident_record(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize one exported accident row before COPY into Supabase."""
    prepared = dict(row)
    prepared["zipcode"] = normalize_zip(prepared.get("zipcode"))

    for column in ACCIDENT_BOOL_COLUMNS:
        if column in prepared:
            prepared[column] = parse_bool(prepared[column])

    for column in ACCIDENT_NUMERIC_COLUMNS:
        if column in prepared:
            prepared[column] = parse_number(prepared[column])

    prepared["raw_payload"] = json.dumps(row, sort_keys=True)
    return prepared


def prepare_hf_accident_record(
    row: dict[str, Any],
    import_batch_id: str | None = None,
) -> dict[str, Any]:
    """Normalize one Hugging Face accident row for the Supabase table."""
    normalized = {sanitize_column_name(key): clean_copy_value(value) for key, value in row.items()}
    raw_payload = {key: clean_copy_value(value) for key, value in row.items()}
    prepared = prepare_accident_record(normalized)
    prepared["location"] = build_location_wkt(prepared)
    prepared["import_batch_id"] = import_batch_id
    prepared["raw_payload"] = json.dumps(raw_payload, sort_keys=True, default=str, allow_nan=False)
    return prepared


def accident_hf_batch_iter(source: AccidentSource, batch_size: int) -> Iterable[pd.DataFrame]:
    from datasets import load_dataset

    dataset = load_dataset(
        source.hf_repo,
        name=source.hf_config,
        split=source.hf_split,
        streaming=True,
    )
    for batch in dataset.iter(batch_size=batch_size):
        yield pd.DataFrame(batch)


def source_metadata(source: AccidentSource) -> dict[str, Any]:
    return {
        "key": source.key,
        "hf_repo": source.hf_repo,
        "hf_config": source.hf_config,
        "hf_split": source.hf_split,
        "expected_row_count": source.expected_row_count,
        "expected_column_count": source.expected_column_count,
        "license": source.license,
        "role": source.role,
        "duplicate_of": source.duplicate_of,
        "notes": source.notes,
    }


def decide_accident_import(
    existing_count: int,
    sample_overlap: int,
    sample_size: int,
    source: AccidentSource,
) -> str:
    if existing_count == 0:
        return "load"
    if existing_count == source.expected_row_count and sample_overlap == sample_size:
        return "skip"
    if existing_count < source.expected_row_count:
        return "blocked_partial_existing"
    return "blocked_existing_mismatch"


def inspect_accident_import(conn, source: AccidentSource) -> dict[str, Any]:
    count_row = conn.execute(
        "SELECT COUNT(*) AS row_count, MIN(start_time) AS min_start_time, MAX(start_time) AS max_start_time FROM accidents"
    ).fetchone()
    existing_count = int(count_row[0] or 0)
    min_start_time = count_row[1]
    max_start_time = count_row[2]

    placeholders = ", ".join(["%s"] * len(ACCIDENT_SAMPLE_IDS))
    overlap_row = conn.execute(
        f"SELECT COUNT(DISTINCT id) FROM accidents WHERE id IN ({placeholders})",
        ACCIDENT_SAMPLE_IDS,
    ).fetchone()
    sample_overlap = int(overlap_row[0] or 0)

    decision = decide_accident_import(
        existing_count=existing_count,
        sample_overlap=sample_overlap,
        sample_size=len(ACCIDENT_SAMPLE_IDS),
        source=source,
    )
    return {
        "source": source_metadata(source),
        "existing_row_count": existing_count,
        "expected_row_count": source.expected_row_count,
        "min_start_time": min_start_time.isoformat() if hasattr(min_start_time, "isoformat") else min_start_time,
        "max_start_time": max_start_time.isoformat() if hasattr(max_start_time, "isoformat") else max_start_time,
        "sample_ids": ACCIDENT_SAMPLE_IDS,
        "sample_overlap": sample_overlap,
        "sample_size": len(ACCIDENT_SAMPLE_IDS),
        "decision": decision,
    }


def record_accident_import_source(
    conn,
    source: AccidentSource,
    *,
    status: str,
    import_batch_id: str,
    loaded_rows: int,
    inspection: dict[str, Any] | None,
    notes: str,
) -> None:
    conn.execute(
        """
        INSERT INTO accident_import_sources (
          source_key,
          hf_repo,
          hf_config,
          hf_split,
          expected_row_count,
          expected_column_count,
          license,
          status,
          import_batch_id,
          loaded_rows,
          observed_existing_rows,
          sample_overlap,
          notes
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            source.key,
            source.hf_repo,
            source.hf_config,
            source.hf_split,
            source.expected_row_count,
            source.expected_column_count,
            source.license,
            status,
            import_batch_id,
            loaded_rows,
            inspection.get("existing_row_count") if inspection else None,
            inspection.get("sample_overlap") if inspection else None,
            notes,
        ),
    )


def load_huggingface_accidents(
    conn,
    *,
    source_key: str | None = None,
    batch_size: int = 50_000,
    replace: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    source = get_accident_source(source_key)
    inspection = inspect_accident_import(conn, source)
    batch_id = f"{source.key}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"

    if dry_run:
        return {"batch_id": batch_id, "loaded_rows": 0, "inspection": inspection}

    if inspection["decision"] == "skip" and not replace:
        record_accident_import_source(
            conn,
            source,
            status="skipped_duplicate",
            import_batch_id=batch_id,
            loaded_rows=0,
            inspection=inspection,
            notes="Canonical accident corpus already present; no rows loaded.",
        )
        conn.commit()
        return {"batch_id": batch_id, "loaded_rows": 0, "inspection": inspection}

    if inspection["decision"] != "load" and not replace:
        raise RuntimeError(
            "accidents already contains data that does not qualify for a safe append. "
            f"Decision={inspection['decision']}; use --replace after reviewing inspect output."
        )

    if replace:
        conn.execute("TRUNCATE accidents, accident_density;")
        conn.commit()

    loaded_rows = 0
    for batch in accident_hf_batch_iter(source, batch_size):
        rows = []
        records = batch.to_dict(orient="records")
        for raw_row in records:
            prepared = prepare_hf_accident_record(raw_row, import_batch_id=batch_id)
            rows.append([prepared.get(column) for column in ACCIDENT_COPY_COLUMNS])
        loaded_rows += copy_rows(conn, "accidents", ACCIDENT_COPY_COLUMNS, rows)
        conn.commit()
        print(f"{source.key}: {loaded_rows} accident rows", file=sys.stderr, flush=True)

    execute_sql(conn, SPATIAL_REFRESH_SQL)
    execute_sql(conn, DENSITY_REFRESH_SQL)
    record_accident_import_source(
        conn,
        source,
        status="loaded",
        import_batch_id=batch_id,
        loaded_rows=loaded_rows,
        inspection=inspection,
        notes="Loaded from Hugging Face canonical accident source.",
    )
    conn.commit()
    return {"batch_id": batch_id, "loaded_rows": loaded_rows, "inspection": inspection}


def prepare_boundary_record(row: dict[str, Any]) -> dict[str, Any]:
    """Normalize one zipcode boundary row and stage GeoJSON as JSONB text."""
    prepared = dict(row)
    prepared["zip_code"] = normalize_zip(prepared.get("zip_code"))

    boundary = prepared.pop("boundary_geo", None) or prepared.get("boundary_geojson")
    if isinstance(boundary, str) and boundary:
        prepared["boundary_geojson"] = json.dumps(json.loads(boundary), sort_keys=True)

    return prepared


def read_csv_records(path: Path, table: str) -> tuple[list[str], list[dict[str, Any]]]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        records = []
        for row in reader:
            if table == "accidents":
                records.append(prepare_accident_record(row))
            elif table == "zipcode_boundaries":
                records.append(prepare_boundary_record(row))
            else:
                records.append(dict(row))

    columns = sorted({key for record in records for key in record.keys()})
    return columns, records


def connect(database_url: str):
    import psycopg

    conn = psycopg.connect(database_url)
    conn.execute("SET default_transaction_read_only = off")
    conn.commit()
    return conn


def copy_records(conn, table: str, columns: list[str], records: list[dict[str, Any]], truncate: bool = False) -> int:
    table = sanitize_identifier(table)
    if table not in KNOWN_TABLES:
        raise ValueError(f"Unsupported table: {table}")
    columns = [sanitize_identifier(column) for column in columns]

    if truncate:
        conn.execute(f"TRUNCATE {table};")

    if not records:
        return 0

    column_sql = ", ".join(columns)
    copy_sql = f"COPY {table} ({column_sql}) FROM STDIN WITH (FORMAT csv)"
    with conn.cursor() as cur:
        with cur.copy(copy_sql) as copy:
            for record in records:
                copy.write_row([record.get(column) for column in columns])

    return len(records)


def copy_rows(conn, table: str, columns: list[str], rows: Iterable[Iterable[Any]]) -> int:
    table = sanitize_relation(table)
    columns = [sanitize_identifier(column) for column in columns]
    column_sql = ", ".join(columns)
    copy_sql = f"COPY {table} ({column_sql}) FROM STDIN"
    count = 0
    with conn.cursor() as cur:
        with cur.copy(copy_sql) as copy:
            for row in rows:
                copy.write_row(row)
                count += 1
    return count


def redact_json_payload(value: Any, keys: set[str]) -> Any:
    if not keys or value in (None, ""):
        return value

    if isinstance(value, str):
        payload = json.loads(value)
    else:
        payload = value

    if not isinstance(payload, dict):
        return value

    for key in keys:
        payload.pop(key, None)

    return json.dumps(payload, sort_keys=True)


def row_values(row: Any, columns: list[str], json_remove_keys: Iterable[str] = ()) -> list[Any]:
    remove_keys = set(json_remove_keys)
    values = []
    for column in columns:
        value = row[column]
        if column == "raw_payload":
            value = redact_json_payload(value, remove_keys)
        if hasattr(value, "isoformat"):
            values.append(value.isoformat())
        elif isinstance(value, (dict, list)):
            values.append(json.dumps(value, sort_keys=True))
        else:
            values.append(value)
    return values


def transfer_bigquery_query(conn, bq_client: Any, transfer: dict[str, Any], batch_size: int = 50_000) -> int:
    job = bq_client.query(transfer["sql"])
    result = job.result(page_size=batch_size)
    total = 0
    batch: list[list[Any]] = []

    for row in result:
        batch.append(row_values(row, transfer["columns"], transfer.get("json_remove_keys", ())))
        if len(batch) >= batch_size:
            total += copy_rows(conn, transfer["table"], transfer["columns"], batch)
            conn.commit()
            batch.clear()
            print(f"{transfer['name']}: {total} rows", file=sys.stderr, flush=True)

    if batch:
        total += copy_rows(conn, transfer["table"], transfer["columns"], batch)
        conn.commit()
        print(f"{transfer['name']}: {total} rows", file=sys.stderr, flush=True)

    return total


def load_bigquery_core(conn, transfers: list[str] | None = None, truncate: bool = False) -> dict[str, int]:
    from google.cloud import bigquery

    selected = [
        transfer for transfer in CORE_BIGQUERY_TRANSFERS
        if transfers is None or transfer["name"] in transfers
    ]
    if truncate and selected:
        tables = ", ".join(sanitize_identifier(transfer["table"]) for transfer in selected)
        conn.execute(f"TRUNCATE {tables} RESTART IDENTITY;")
        conn.commit()

    client = bigquery.Client(project="n8n-workspace-apis")
    loaded: dict[str, int] = {}
    for transfer in selected:
        print(f"loading {transfer['name']} -> {transfer['table']}", file=sys.stderr, flush=True)
        loaded[transfer["name"]] = transfer_bigquery_query(conn, client, transfer)

    return loaded


def load_bigquery_pii(conn, transfers: list[str] | None = None, truncate: bool = False) -> dict[str, int]:
    from google.cloud import bigquery

    selected = [
        transfer for transfer in PII_BIGQUERY_TRANSFERS
        if transfers is None or transfer["name"] in transfers
    ]
    if truncate and selected:
        tables = ", ".join(sanitize_relation(transfer["table"]) for transfer in selected)
        conn.execute(f"TRUNCATE {tables} RESTART IDENTITY;")
        conn.commit()

    client = bigquery.Client(project="n8n-workspace-apis")
    loaded: dict[str, int] = {}
    for transfer in selected:
        print(f"loading {transfer['name']} -> {transfer['table']}", file=sys.stderr, flush=True)
        loaded[transfer["name"]] = transfer_bigquery_query(conn, client, transfer)

    return loaded


def copy_csv_to_table(conn, table: str, csv_path: Path, truncate: bool = False) -> int:
    columns, records = read_csv_records(csv_path, table)
    return copy_records(conn, table, columns, records, truncate=truncate)


def execute_sql(conn, sql: str) -> None:
    conn.execute(sql)


def load_export_dir(conn, export_dir: Path, truncate: bool = False) -> dict[str, int]:
    """Load known table CSVs from an export directory by filename."""
    loaded: dict[str, int] = {}
    for table in sorted(KNOWN_TABLES):
        path = export_dir / f"{table}.csv"
        if path.exists():
            loaded[table] = copy_csv_to_table(conn, table, path, truncate=truncate)
    return loaded


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    apply_schema = subcommands.add_parser("apply-schema")
    apply_schema.add_argument("sql_file", type=Path)

    load_csv = subcommands.add_parser("load-csv")
    load_csv.add_argument("table", choices=sorted(KNOWN_TABLES))
    load_csv.add_argument("csv_path", type=Path)
    load_csv.add_argument("--truncate", action="store_true")

    load_dir = subcommands.add_parser("load-export-dir")
    load_dir.add_argument("export_dir", type=Path)
    load_dir.add_argument("--truncate", action="store_true")

    subcommands.add_parser("populate-spatial")
    subcommands.add_parser("refresh-density")

    load_bq = subcommands.add_parser("load-bigquery-core")
    load_bq.add_argument("--truncate", action="store_true")
    load_bq.add_argument(
        "--table",
        action="append",
        choices=[transfer["name"] for transfer in CORE_BIGQUERY_TRANSFERS],
        help="Transfer only this logical table; repeatable. Defaults to all core non-PII portal/geo tables.",
    )

    load_pii = subcommands.add_parser("load-bigquery-pii")
    load_pii.add_argument("--truncate", action="store_true")
    load_pii.add_argument(
        "--table",
        action="append",
        choices=[transfer["name"] for transfer in PII_BIGQUERY_TRANSFERS],
        help="Transfer only this PII table; repeatable. Defaults to all PII tables.",
    )

    inspect_source = subcommands.add_parser("inspect-accident-source")
    inspect_source.add_argument("--source", default=CANONICAL_ACCIDENT_SOURCE_KEY)

    load_hf = subcommands.add_parser("load-huggingface-accidents")
    load_hf.add_argument("--source", default=CANONICAL_ACCIDENT_SOURCE_KEY)
    load_hf.add_argument("--batch-size", type=int, default=50_000)
    load_hf.add_argument("--replace", action="store_true")
    load_hf.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.database_url and args.command != "inspect-accident-source":
        parser.error("--database-url or SUPABASE_DB_URL is required")

    if args.command == "inspect-accident-source" and not args.database_url:
        print(json.dumps({"source": source_metadata(get_accident_source(args.source))}, indent=2))
        return 0

    with connect(args.database_url) as conn:
        if args.command == "apply-schema":
            execute_sql(conn, args.sql_file.read_text())
        elif args.command == "load-csv":
            count = copy_csv_to_table(conn, args.table, args.csv_path, truncate=args.truncate)
            print(f"loaded {count} rows into {args.table}")
        elif args.command == "load-export-dir":
            loaded = load_export_dir(conn, args.export_dir, truncate=args.truncate)
            for table, count in loaded.items():
                print(f"loaded {count} rows into {table}")
        elif args.command == "populate-spatial":
            execute_sql(conn, SPATIAL_REFRESH_SQL)
        elif args.command == "refresh-density":
            execute_sql(conn, DENSITY_REFRESH_SQL)
        elif args.command == "load-bigquery-core":
            loaded = load_bigquery_core(conn, transfers=args.table, truncate=args.truncate)
            for table, count in loaded.items():
                print(f"loaded {count} rows for {table}")
        elif args.command == "load-bigquery-pii":
            loaded = load_bigquery_pii(conn, transfers=args.table, truncate=args.truncate)
            for table, count in loaded.items():
                print(f"loaded {count} rows for {table}")
        elif args.command == "inspect-accident-source":
            result = inspect_accident_import(conn, get_accident_source(args.source))
            print(json.dumps(result, indent=2, default=str))
        elif args.command == "load-huggingface-accidents":
            result = load_huggingface_accidents(
                conn,
                source_key=args.source,
                batch_size=args.batch_size,
                replace=args.replace,
                dry_run=args.dry_run,
            )
            print(json.dumps(result, indent=2, default=str))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
