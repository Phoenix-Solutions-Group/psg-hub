#!/usr/bin/env python3
"""Create the accident_density summary table in BigQuery.

Aggregates 7.7M accident records by zip, year, and severity level into a
pre-computed density table. Drops and recreates on each run for idempotency.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery

from utils import get_client
from config import PROJECT_ID, DATASET_ID


DENSITY_TABLE = f"{PROJECT_ID}.{DATASET_ID}.accident_density"

CTAS_QUERY = f"""
CREATE TABLE `{DENSITY_TABLE}` AS
SELECT
    zipcode AS zip,
    state,
    EXTRACT(YEAR FROM start_time) AS year,
    COUNTIF(severity = 1) AS severity_1_count,
    COUNTIF(severity = 2) AS severity_2_count,
    COUNTIF(severity = 3) AS severity_3_count,
    COUNTIF(severity = 4) AS severity_4_count,
    COUNT(*) AS total_count,
    COUNTIF(
        LOWER(weather_condition) LIKE '%rain%'
        OR LOWER(weather_condition) LIKE '%snow%'
        OR LOWER(weather_condition) LIKE '%fog%'
        OR LOWER(weather_condition) LIKE '%ice%'
        OR LOWER(weather_condition) LIKE '%sleet%'
        OR LOWER(weather_condition) LIKE '%storm%'
        OR LOWER(weather_condition) LIKE '%hail%'
        OR LOWER(weather_condition) LIKE '%freezing%'
        OR LOWER(weather_condition) LIKE '%wintry%'
        OR LOWER(weather_condition) LIKE '%blizzard%'
    ) AS weather_related_count
FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
WHERE zipcode IS NOT NULL
GROUP BY zipcode, state, EXTRACT(YEAR FROM start_time)
"""


def main():
    """Drop existing density table and recreate from accidents data."""
    client = get_client()

    # Drop existing table for idempotency
    print(f"Dropping {DENSITY_TABLE} if it exists...")
    client.delete_table(DENSITY_TABLE, not_found_ok=True)

    # Create table via CTAS
    print("Running CTAS query to build accident_density...")
    job = client.query(CTAS_QUERY)
    job.result()  # Wait for completion

    # Report row count
    table = client.get_table(DENSITY_TABLE)
    print(f"Created {DENSITY_TABLE} with {table.num_rows} rows")
    return table.num_rows


if __name__ == "__main__":
    count = main()
    if count == 0:
        print("WARNING: Table created with 0 rows")
        sys.exit(1)
