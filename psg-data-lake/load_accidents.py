"""Load US Accidents data into BigQuery with partitioning and clustering."""

import sys
import os
import re
from collections.abc import Iterator

import pandas as pd
from google.cloud import bigquery

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import get_client, normalize_zip
from utils.schemas import ACCIDENTS_SCHEMA
from config import (
    PROJECT_ID,
    DATASET_ID,
    ACCIDENTS_CSV_PATH,
    ACCIDENTS_SOURCE,
    ACCIDENTS_HF_REPO,
    ACCIDENTS_HF_CONFIG,
    ACCIDENTS_HF_SPLIT,
)

TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.accidents"
STAGING_TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.accidents_staging"
CHUNK_SIZE = 100_000

# Special column renames where sanitize_column_name alone is insufficient
COLUMN_RENAMES = {
    "Humidity(%)": "humidity_pct",
    "Distance(mi)": "distance_mi",
    "Temperature(F)": "temperature_f",
    "Wind_Chill(F)": "wind_chill_f",
    "Pressure(in)": "pressure_in",
    "Visibility(mi)": "visibility_mi",
    "Wind_Speed(mph)": "wind_speed_mph",
    "Precipitation(in)": "precipitation_in",
}

FLOAT_COLUMNS = [
    "start_lat", "start_lng", "end_lat", "end_lng",
    "distance_mi", "temperature_f", "wind_chill_f",
    "humidity_pct", "pressure_in", "visibility_mi",
    "wind_speed_mph", "precipitation_in",
]

BOOLEAN_COLUMNS = [
    "amenity", "bump", "crossing", "give_way", "junction",
    "no_exit", "railway", "roundabout", "station", "stop",
    "traffic_calming", "traffic_signal", "turning_loop",
]

DATETIME_COLUMNS = ["start_time", "end_time", "weather_timestamp"]
SCHEMA_COLUMNS = [field.name for field in ACCIDENTS_SCHEMA]


def sanitize_column_name(name: str) -> str:
    """Convert CSV column name to BigQuery-safe snake_case.

    Applies COLUMN_RENAMES overrides first, then falls back to regex sanitization.
    """
    if name in COLUMN_RENAMES:
        return COLUMN_RENAMES[name]
    name = name.lower()
    name = re.sub(r"[^a-z0-9_]", "_", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("_")


def accident_chunk_iter() -> Iterator[pd.DataFrame]:
    """Yield accident rows from the configured source in dataframe chunks."""
    source = ACCIDENTS_SOURCE.lower()

    if source == "csv":
        yield from pd.read_csv(ACCIDENTS_CSV_PATH, chunksize=CHUNK_SIZE, dtype=str)
        return

    if source == "huggingface":
        from datasets import load_dataset

        dataset = load_dataset(
            ACCIDENTS_HF_REPO,
            name=ACCIDENTS_HF_CONFIG,
            split=ACCIDENTS_HF_SPLIT,
            streaming=True,
        )
        for batch in dataset.iter(batch_size=CHUNK_SIZE):
            yield pd.DataFrame(batch)
        return

    raise ValueError(
        "ACCIDENTS_SOURCE must be 'huggingface' or 'csv', "
        f"got {ACCIDENTS_SOURCE!r}"
    )


def prepare_accident_chunk(chunk: pd.DataFrame) -> pd.DataFrame:
    """Normalize raw accident rows to the declared BigQuery schema."""
    chunk = chunk.copy()
    chunk.columns = [sanitize_column_name(c) for c in chunk.columns]

    # Normalize zip codes to 5-digit strings
    chunk["zipcode"] = chunk["zipcode"].apply(normalize_zip)

    # Cast datetime columns (required for partitioning on start_time)
    # Truncate to microseconds to avoid ArrowInvalid when converting to Parquet
    for col in DATETIME_COLUMNS:
        if col in chunk.columns:
            chunk[col] = pd.to_datetime(chunk[col], errors="coerce").dt.floor("us")

    # Cast severity to nullable integer
    chunk["severity"] = pd.to_numeric(chunk["severity"], errors="coerce").astype("Int64")

    # Cast float columns
    for col in FLOAT_COLUMNS:
        if col in chunk.columns:
            chunk[col] = pd.to_numeric(chunk[col], errors="coerce")

    # Cast boolean columns from either native bools or string True/False values
    bool_map = {"True": True, "False": False, True: True, False: False}
    for col in BOOLEAN_COLUMNS:
        if col in chunk.columns:
            chunk[col] = chunk[col].map(bool_map)

    for col in SCHEMA_COLUMNS:
        if col not in chunk.columns:
            chunk[col] = pd.NA

    return chunk[SCHEMA_COLUMNS]


def load_accidents():
    """Read accident data in chunks and load into BigQuery.

    Loads data into a non-partitioned staging table first to avoid BigQuery
    partition modification quotas, then uses CTAS to create the final
    partitioned and clustered table.
    """
    client = get_client()

    # Step 1: Load all chunks into staging table (no partitioning)
    print("Loading into staging table...")
    chunk_iter = accident_chunk_iter()

    for i, chunk in enumerate(chunk_iter):
        chunk = prepare_accident_chunk(chunk)

        # First chunk truncates, subsequent chunks append
        disposition = "WRITE_TRUNCATE" if i == 0 else "WRITE_APPEND"

        # Load into staging table without partitioning to avoid quota limits
        job_config = bigquery.LoadJobConfig(
            schema=ACCIDENTS_SCHEMA,
            write_disposition=disposition,
        )

        job = client.load_table_from_dataframe(chunk, STAGING_TABLE_ID, job_config=job_config)
        job.result()
        print(f"  Chunk {i + 1}: {len(chunk)} rows ({disposition})")

    staging_table = client.get_table(STAGING_TABLE_ID)
    print(f"Staging complete: {staging_table.num_rows} rows")

    # Step 2: Drop existing final table if it exists
    print("Replacing final table via CTAS...")
    client.delete_table(TABLE_ID, not_found_ok=True)

    # Step 3: CTAS to create partitioned/clustered final table from staging
    column_list = ", ".join(f.name for f in ACCIDENTS_SCHEMA)
    ctas_query = f"""
        CREATE TABLE `{TABLE_ID}`
        PARTITION BY DATE(start_time)
        CLUSTER BY state, zipcode
        AS SELECT {column_list}
        FROM `{STAGING_TABLE_ID}`
    """
    client.query(ctas_query).result()

    # Step 4: Clean up staging table
    client.delete_table(STAGING_TABLE_ID, not_found_ok=True)
    print("  Staging table deleted")

    # Report final row count
    table = client.get_table(TABLE_ID)
    print(f"Load complete: {table.num_rows} total rows")
    return table.num_rows


def add_geography_column():
    """Add and populate accident_geo GEOGRAPHY column via BigQuery SQL.

    Creates the column if it does not exist, then populates it with
    ST_GEOGPOINT(start_lng, start_lat) for rows with valid US-bounded
    coordinates. Rows with NULL or out-of-bounds coordinates get NULL.
    """
    client = get_client()

    # Add column
    print("Adding accident_geo column...")
    client.query(f"""
        ALTER TABLE `{TABLE_ID}`
        ADD COLUMN IF NOT EXISTS accident_geo GEOGRAPHY
    """).result()
    print("  Column added (or already exists)")

    # Populate with validated coordinates (longitude first, latitude second)
    print("Populating accident_geo with ST_GEOGPOINT...")
    job = client.query(f"""
        UPDATE `{TABLE_ID}`
        SET accident_geo = ST_GEOGPOINT(start_lng, start_lat)
        WHERE start_lat IS NOT NULL
          AND start_lng IS NOT NULL
          AND start_lat BETWEEN 24.0 AND 72.0
          AND start_lng BETWEEN -180.0 AND -60.0
    """)
    result = job.result()
    print(f"  Updated {result.num_dml_affected_rows} rows")

    # Validation summary
    print("Validation summary:")
    rows = list(client.query(f"""
        SELECT
            COUNT(*) as total,
            COUNTIF(accident_geo IS NOT NULL) as has_geo,
            COUNTIF(accident_geo IS NULL) as no_geo,
            COUNTIF(start_lat IS NULL OR start_lng IS NULL) as null_coords
        FROM `{TABLE_ID}`
    """).result())
    row = rows[0]
    print(f"  Total rows: {row.total}")
    print(f"  With geo:   {row.has_geo}")
    print(f"  Without:    {row.no_geo}")
    print(f"  Null coords: {row.null_coords}")


if __name__ == "__main__":
    load_accidents()
    add_geography_column()
