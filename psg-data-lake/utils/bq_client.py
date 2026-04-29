"""BigQuery client factory."""

from google.cloud import bigquery

from config import SERVICE_ACCOUNT_PATH, PROJECT_ID


def get_client() -> bigquery.Client:
    """Return an authenticated BigQuery client."""
    return bigquery.Client.from_service_account_json(
        SERVICE_ACCOUNT_PATH,
        project=PROJECT_ID,
    )
