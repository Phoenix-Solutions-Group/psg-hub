"""Load ZCTA-to-zip crosswalk from CSV into BigQuery."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery
from utils import get_client
from utils.schemas import ZCTA_ZIP_SCHEMA
from config import PROJECT_ID, DATASET_ID, DATA_DIR


TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.zcta_zip_mapping"


def load_zcta_crosswalk():
    """Load zip_to_zcta.csv into BigQuery zcta_zip_mapping table."""
    client = get_client()

    csv_path = os.path.join(DATA_DIR, "zip_to_zcta.csv")

    job_config = bigquery.LoadJobConfig(
        schema=ZCTA_ZIP_SCHEMA,
        source_format=bigquery.SourceFormat.CSV,
        skip_leading_rows=1,
        write_disposition="WRITE_TRUNCATE",
    )

    with open(csv_path, "rb") as f:
        job = client.load_table_from_file(f, TABLE_ID, job_config=job_config)

    job.result()

    table = client.get_table(TABLE_ID)
    print(f"Loaded {table.num_rows} rows into {TABLE_ID}")
    return table.num_rows


if __name__ == "__main__":
    load_zcta_crosswalk()
