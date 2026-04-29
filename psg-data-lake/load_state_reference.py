#!/usr/bin/env python3
"""Load state reference data into BigQuery.

Reads state-codes.json and loads 57 rows into psg_geo_data.state_reference.
Uses WRITE_TRUNCATE for idempotent re-runs.
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery

from utils import get_client
from utils.schemas import STATE_REFERENCE_SCHEMA
from config import DATASET_ID, DATA_DIR


def load_state_reference():
    """Read state-codes.json and load into BigQuery."""
    source_path = os.path.join(DATA_DIR, "state-codes.json")
    with open(source_path, "r") as f:
        raw = json.load(f)

    rows = []
    for fips_code, info in raw.items():
        rows.append({
            "state_fips": str(fips_code).zfill(2),
            "state_abbr": info["stateAbbr"],
            "state_name": info["name"],
        })

    client = get_client()
    table_id = f"{client.project}.{DATASET_ID}.state_reference"

    job_config = bigquery.LoadJobConfig(
        schema=STATE_REFERENCE_SCHEMA,
        write_disposition=bigquery.WriteDisposition.WRITE_TRUNCATE,
    )

    job = client.load_table_from_json(rows, table_id, job_config=job_config)
    job.result()  # Wait for completion

    table = client.get_table(table_id)
    print(f"Loaded {table.num_rows} rows into {table_id}")
    return table.num_rows


if __name__ == "__main__":
    count = load_state_reference()
    if count != 57:
        print(f"WARNING: Expected 57 rows, got {count}")
        sys.exit(1)
