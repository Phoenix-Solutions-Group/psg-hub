"""Integration tests for zcta_zip_mapping table in BigQuery."""

import pytest

pytestmark = pytest.mark.integration


def test_zcta_row_count(bq_client):
    """zcta_zip_mapping should have exactly 41,250 rows."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.zcta_zip_mapping")
    assert table.num_rows == 41250, (
        f"Expected 41,250 rows, got {table.num_rows}"
    )


def test_zcta_zip_format(bq_client):
    """All zip_code values must be exactly 5 digits."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zcta_zip_mapping
        WHERE LENGTH(zip_code) != 5 OR REGEXP_CONTAINS(zip_code, r'[^0-9]')
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, f"Found {rows[0].n} malformed zip codes"


def test_zcta_known_entry(bq_client):
    """Zip 00601 (Adjuntas, PR) should exist in the crosswalk."""
    query = """
        SELECT city_name, state_abbr
        FROM psg_geo_data.zcta_zip_mapping
        WHERE zip_code = '00601'
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) > 0, "Zip 00601 not found in zcta_zip_mapping"
    assert rows[0].city_name == "Adjuntas", (
        f"Expected city 'Adjuntas' for zip 00601, got '{rows[0].city_name}'"
    )


def test_zcta_column_not_all_null(bq_client):
    """The zcta column should have non-null values."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zcta_zip_mapping
        WHERE zcta IS NOT NULL AND zcta != ''
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n > 0, "All zcta values are NULL or empty"
