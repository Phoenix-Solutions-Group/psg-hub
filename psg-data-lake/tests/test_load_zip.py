"""Integration tests for zip_reference table in BigQuery."""

import pytest

pytestmark = pytest.mark.integration


def test_zip_reference_row_count(bq_client):
    """zip_reference should have ~33,120 rows (one per zip-county pair)."""
    table = bq_client.get_table("n8n-workspace-apis.psg_geo_data.zip_reference")
    assert 33000 <= table.num_rows <= 34000, (
        f"Expected 33,000-34,000 rows, got {table.num_rows}"
    )


def test_zip_reference_zip_format(bq_client):
    """All zip_code values must be exactly 5 digits."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zip_reference
        WHERE LENGTH(zip_code) != 5 OR REGEXP_CONTAINS(zip_code, r'[^0-9]')
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, f"Found {rows[0].n} malformed zip codes"


def test_zip_reference_state_fips_format(bq_client):
    """All state_fips values must be exactly 2 characters."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zip_reference
        WHERE LENGTH(state_fips) != 2
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, f"Found {rows[0].n} malformed state_fips values"


def test_zip_reference_county_fips_format(bq_client):
    """All county_fips values must be exactly 5 characters."""
    query = """
        SELECT COUNT(*) as n
        FROM psg_geo_data.zip_reference
        WHERE LENGTH(county_fips) != 5
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, f"Found {rows[0].n} malformed county_fips values"


def test_zip_reference_known_entry(bq_client):
    """NYC zip 10001 should exist with New York state_fips 36."""
    query = """
        SELECT state_fips
        FROM psg_geo_data.zip_reference
        WHERE zip_code = '10001'
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) > 0, "Zip 10001 not found in zip_reference"
    assert rows[0].state_fips == "36", (
        f"Expected state_fips '36' for zip 10001, got '{rows[0].state_fips}'"
    )


def test_zip_reference_idempotent(bq_client):
    """Re-running load should produce the same row count."""
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from load_zip_reference import load_zip_reference

    count_before = bq_client.get_table(
        "n8n-workspace-apis.psg_geo_data.zip_reference"
    ).num_rows

    load_zip_reference()

    count_after = bq_client.get_table(
        "n8n-workspace-apis.psg_geo_data.zip_reference"
    ).num_rows

    assert count_before == count_after, (
        f"Row count changed after re-load: {count_before} -> {count_after}"
    )
