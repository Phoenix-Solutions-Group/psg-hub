"""Integration tests for accidents table in BigQuery.

These tests validate the post-execution state of the accident loader.
They will fail until Plan 03-02 executes the loader and adds the GEOGRAPHY
column. This is expected (Wave 0 pattern).
"""

import pytest

pytestmark = pytest.mark.integration


def test_accident_row_count(bq_client):
    """ACC-01: accidents table should have ~7.7M rows."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.accidents")
    assert 7_700_000 <= table.num_rows <= 7_800_000, (
        f"Expected 7,700,000-7,800,000 rows, got {table.num_rows}"
    )


def test_partitioning_and_clustering(bq_client):
    """ACC-03: table partitioned by start_time (DAY) and clustered by state, zipcode."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.accidents")
    assert table.time_partitioning is not None, "Expected time partitioning"
    assert table.time_partitioning.field == "start_time", (
        f"Expected partition field 'start_time', got '{table.time_partitioning.field}'"
    )
    assert table.time_partitioning.type_ == "DAY", (
        f"Expected DAY partitioning, got '{table.time_partitioning.type_}'"
    )
    assert table.clustering_fields == ["state", "zipcode"], (
        f"Expected clustering on ['state', 'zipcode'], got {table.clustering_fields}"
    )


def test_zip_format(bq_client):
    """ACC-05: all zip codes must be exactly 5 digits (excluding NULLs)."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.accidents
        WHERE zipcode IS NOT NULL
          AND (LENGTH(zipcode) != 5 OR REGEXP_CONTAINS(zipcode, r'[^0-9]'))
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, f"Found {rows[0].n} malformed zip codes"


def test_accident_geo_us_bounds(bq_client):
    """ACC-02: lat/lng values fall within US bounding box."""
    query = """
        SELECT
            COUNT(*) as total,
            COUNTIF(start_lat < 24.0 OR start_lat > 72.0
                 OR start_lng < -180.0 OR start_lng > -60.0) as out_of_bounds
        FROM psg_geo_data.accidents
        WHERE start_lat IS NOT NULL AND start_lng IS NOT NULL
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].total > 0, "Expected rows with coordinates"
    assert rows[0].out_of_bounds == 0, (
        f"Found {rows[0].out_of_bounds} points outside US bounds"
    )


def test_accident_geo_column_exists(bq_client):
    """ACC-02: accident_geo GEOGRAPHY column exists and has non-null values."""
    query = """
        SELECT accident_geo
        FROM psg_geo_data.accidents
        WHERE accident_geo IS NOT NULL
        LIMIT 1
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) == 1, "Expected at least 1 row with non-null accident_geo"


def test_column_names_sanitized(bq_client):
    """ACC-01: all column names are lowercase snake_case, no parentheses."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.accidents")
    field_names = [f.name for f in table.schema]

    for name in field_names:
        assert "(" not in name and ")" not in name, (
            f"Column '{name}' contains parentheses"
        )
        assert name == name.lower(), f"Column '{name}' is not lowercase"

    expected_columns = [
        "id", "severity", "start_time", "start_lat", "start_lng",
        "zipcode", "state", "distance_mi", "temperature_f",
    ]
    for col in expected_columns:
        assert col in field_names, f"Expected column '{col}' not found in schema"


def test_start_time_is_timestamp(bq_client):
    """ACC-03: start_time column must be TIMESTAMP type for partitioning."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.accidents")
    field_map = {f.name: f for f in table.schema}
    assert "start_time" in field_map, "start_time column not found"
    assert field_map["start_time"].field_type == "TIMESTAMP", (
        f"Expected TIMESTAMP, got '{field_map['start_time'].field_type}'"
    )
