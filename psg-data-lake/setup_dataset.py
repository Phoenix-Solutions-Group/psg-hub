#!/usr/bin/env python3
"""Create the psg_geo_data dataset in BigQuery.

Idempotent: safe to re-run. Uses exists_ok=True so it won't fail
if the dataset already exists.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from google.cloud import bigquery

from utils import get_client
from config import DATASET_ID


def ensure_dataset(client: bigquery.Client, dataset_id: str) -> None:
    """Create dataset if it does not already exist."""
    dataset_ref = bigquery.Dataset(f"{client.project}.{dataset_id}")
    dataset_ref.location = "US"
    client.create_dataset(dataset_ref, exists_ok=True)


def main():
    client = get_client()
    print(f"Authenticated to project: {client.project}")

    ensure_dataset(client, DATASET_ID)

    # Verify dataset exists
    dataset = client.get_dataset(f"{client.project}.{DATASET_ID}")
    print(f"Dataset '{dataset.dataset_id}' ready (location: {dataset.location})")


if __name__ == "__main__":
    main()
