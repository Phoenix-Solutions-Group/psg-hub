#!/usr/bin/env python3
"""Load county reference data into BigQuery.

Reads county-codes.json and loads 3,235 rows into psg_geo_data.county_reference.
Uses WRITE_TRUNCATE for idempotent re-runs.
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery

from utils import get_client
from utils.schemas import COUNTY_REFERENCE_SCHEMA
from config import DATASET_ID, DATA_DIR


def load_county_reference():
    """Read county-codes.json and load into BigQuery."""
    source_path = os.path.join(DATA_DIR, "county-codes.json")
    with open(source_path, "r") as f:
        raw = json.load(f)

    rows = []
    for fips_code, info in raw.items():
        rows.append({
            "county_fips": str(fips_code).zfill(5),
            "state_abbr": info["stateAbbr"],
            "county_name": info["name"],
            "state_fips": str(info["stateId"]).zfill(2),
        })

    client = get_client()
    table_id = f"{client.project}.{DATASET_ID}.county_reference"

    job_config = bigquery.LoadJobConfig(
        schema=COUNTY_REFERENCE_SCHEMA,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )

    job = client.load_table_from_json(rows, table_id, job_config=job_config)
    job.result()  # Wait for completion

    table = client.get_table(table_id)
    print(f"Loaded {table.num_rows} rows into {table_id}")
    return table.num_rows


if __name__ == "__main__":
    count = load_county_reference()
    if count != 3235:
        print(f"WARNING: Expected 3235 rows, got {count}")
        sys.exit(1)
