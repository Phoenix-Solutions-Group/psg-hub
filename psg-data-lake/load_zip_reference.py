"""Load zip reference data from zip-codes.json into BigQuery."""

import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery
from utils import get_client, normalize_zip, normalize_fips
from utils.schemas import ZIP_REFERENCE_SCHEMA
from config import PROJECT_ID, DATASET_ID, DATA_DIR


TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.zip_reference"


def load_zip_reference():
    """Flatten zip-codes.json and load into BigQuery zip_reference table."""
    client = get_client()

    json_path = os.path.join(DATA_DIR, "zip-codes.json")
    with open(json_path, "r") as f:
        data = json.load(f)

    rows = []
    for zip_code, info in data.items():
        normalized_zip = normalize_zip(zip_code)
        if normalized_zip is None:
            continue

        state_fips = normalize_fips(info["stateId"], 2)
        county_ids = info.get("countyId", [])

        for county_id in county_ids:
            county_fips = state_fips + str(county_id).strip().zfill(3)
            rows.append({
                "zip_code": normalized_zip,
                "state_fips": state_fips,
                "county_fips": county_fips,
            })

    job_config = bigquery.LoadJobConfig(
        schema=ZIP_REFERENCE_SCHEMA,
        write_disposition="WRITE_TRUNCATE",
    )

    job = client.load_table_from_json(rows, TABLE_ID, job_config=job_config)
    job.result()

    table = client.get_table(TABLE_ID)
    print(f"Loaded {table.num_rows} rows into {TABLE_ID}")
    return table.num_rows


if __name__ == "__main__":
    load_zip_reference()
