"""Integration tests for zipcode_boundaries table in BigQuery."""

import pytest
from google.cloud import exceptions

pytestmark = pytest.mark.integration


def test_boundary_row_count(bq_client):
    """zipcode_boundaries should have ~33K rows (one per zip boundary polygon)."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.zipcode_boundaries")
    assert 32000 <= table.num_rows <= 34000, (
        f"Expected 32,000-34,000 rows, got {table.num_rows}"
    )


def test_boundary_columns_exist(bq_client):
    """All three columns (zip_code, state_fips, boundary_geo) must exist."""
    query = """
        SELECT zip_code, state_fips, boundary_geo
        FROM psg_geo_data.zipcode_boundaries
        LIMIT 1
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) == 1, "Expected 1 row from boundary table"


def test_boundary_geo_is_geography(bq_client):
    """boundary_geo column must be GEOGRAPHY type (ST_AREA works on it)."""
    query = """
        SELECT ST_AREA(boundary_geo) as area
        FROM psg_geo_data.zipcode_boundaries
        WHERE boundary_geo IS NOT NULL
        LIMIT 1
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) == 1, "Expected 1 row with non-null geometry"
    assert rows[0].area > 0, "Expected positive area for a valid polygon"


def test_no_globe_spanning_polygons(bq_client):
    """No polygons should span the globe (area > 1e11 sq meters)."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zipcode_boundaries
        WHERE boundary_geo IS NOT NULL
          AND ST_AREA(boundary_geo) > 1e11
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, (
        f"Found {rows[0].n} globe-spanning polygons"
    )


def test_state_coverage(bq_client):
    """At least 50 distinct state_fips values (50 states + DC)."""
    query = """
        SELECT COUNT(DISTINCT state_fips) as n
        FROM psg_geo_data.zipcode_boundaries
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n >= 50, (
        f"Expected at least 50 distinct states, got {rows[0].n}"
    )


def test_zip_format(bq_client):
    """All zip_code values must be exactly 5 digits."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zipcode_boundaries
        WHERE LENGTH(zip_code) != 5 OR REGEXP_CONTAINS(zip_code, r'[^0-9]')
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, f"Found {rows[0].n} malformed zip codes"


def test_staging_table_cleaned_up(bq_client):
    """Staging table should be deleted after successful load."""
    with pytest.raises(exceptions.NotFound):
        bq_client.get_table(
            "n8n-workspace-apis.psg_geo_data._staging_zipcode_boundaries"
        )
