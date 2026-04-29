"""Load zip code boundary polygons from GeoJSON files into BigQuery."""

import sys
import os
import json
import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery
from utils import get_client, normalize_zip
from utils.schemas import ZIPCODE_BOUNDARIES_STAGING_SCHEMA
from config import PROJECT_ID, DATASET_ID, GEOJSON_DIR


STAGING_TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}._staging_zipcode_boundaries"
FINAL_TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.zipcode_boundaries"


def load_zipcode_boundaries():
    """Parse all 51 state GeoJSON files and load boundary polygons into BigQuery.

    Uses a two-step approach:
    1. Load GeoJSON strings into a staging table
    2. CTAS with SAFE.ST_GEOGFROMGEOJSON to create final GEOGRAPHY column
    """
    client = get_client()

    files = sorted(glob.glob(os.path.join(GEOJSON_DIR, "*_zip_codes_geo.min.json")))
    print(f"Found {len(files)} GeoJSON files")

    rows = []
    for filepath in files:
        filename = os.path.basename(filepath)
        with open(filepath, "r") as f:
            data = json.load(f)

        features = data.get("features", [])
        for feature in features:
            props = feature.get("properties", {})
            zip_code = normalize_zip(props.get("ZCTA5CE10", ""))
            if zip_code is None:
                continue
            state_fips = str(props.get("STATEFP10", "")).strip().zfill(2)
            boundary_geojson = json.dumps(feature["geometry"])
            rows.append({
                "zip_code": zip_code,
                "state_fips": state_fips,
                "boundary_geojson": boundary_geojson,
            })

        print(f"  {filename}: {len(features)} features")

    print(f"Total rows: {len(rows)}")

    # Load to staging in chunks of 5000
    chunk_size = 5000
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        disposition = "WRITE_TRUNCATE" if i == 0 else "WRITE_APPEND"
        job_config = bigquery.LoadJobConfig(
            schema=ZIPCODE_BOUNDARIES_STAGING_SCHEMA,
            write_disposition=disposition,
        )
        job = client.load_table_from_json(chunk, STAGING_TABLE_ID, job_config=job_config)
        job.result()
        print(f"  Loaded chunk {i // chunk_size + 1} ({len(chunk)} rows, {disposition})")

    staging_table = client.get_table(STAGING_TABLE_ID)
    print(f"Staging table: {staging_table.num_rows} rows")

    # CTAS to create final table with GEOGRAPHY column
    ctas_query = f"""
    CREATE OR REPLACE TABLE `{FINAL_TABLE_ID}` AS
    SELECT
        zip_code,
        state_fips,
        SAFE.ST_GEOGFROMGEOJSON(boundary_geojson, make_valid => TRUE) AS boundary_geo
    FROM `{STAGING_TABLE_ID}`
    """
    job = client.query(ctas_query)
    job.result()

    final_table = client.get_table(FINAL_TABLE_ID)
    print(f"Final table: {final_table.num_rows} rows")

    # Check for invalid geometries
    null_query = f"""
    SELECT COUNT(*) as n
    FROM `{FINAL_TABLE_ID}`
    WHERE boundary_geo IS NULL
    """
    null_rows = list(client.query(null_query).result())
    print(f"NULL boundary_geo (invalid geometries): {null_rows[0].n}")

    # Clean up staging table
    client.delete_table(STAGING_TABLE_ID)
    print(f"Deleted staging table {STAGING_TABLE_ID}")

    return final_table.num_rows


if __name__ == "__main__":
    load_zipcode_boundaries()
