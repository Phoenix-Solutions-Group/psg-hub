"""Integration tests for the accident_density table."""

import re
import pytest

from config import PROJECT_ID, DATASET_ID


TABLE_ID = f"{PROJECT_ID}.{DATASET_ID}.accident_density"


@pytest.mark.integration
def test_density_row_structure(bq_client):
    """Table exists and has the expected columns with correct types."""
    table = bq_client.get_table(TABLE_ID)
    schema_map = {f.name: f.field_type for f in table.schema}

    assert schema_map["zip"] == "STRING"
    assert schema_map["state"] == "STRING"
    assert schema_map["year"] == "INTEGER"
    assert schema_map["severity_1_count"] == "INTEGER"
    assert schema_map["severity_2_count"] == "INTEGER"
    assert schema_map["severity_3_count"] == "INTEGER"
    assert schema_map["severity_4_count"] == "INTEGER"
    assert schema_map["total_count"] == "INTEGER"
    assert schema_map["weather_related_count"] == "INTEGER"


@pytest.mark.integration
def test_density_has_rows(bq_client):
    """Table has rows and every row has a positive total_count."""
    query = f"SELECT COUNT(*) AS cnt, MIN(total_count) AS min_total FROM `{TABLE_ID}`"
    row = next(iter(bq_client.query(query).result()))
    assert row.cnt > 0, "accident_density table is empty"
    assert row.min_total > 0, "Found rows with total_count <= 0"


@pytest.mark.integration
def test_density_zip_format(bq_client):
    """All zip values are 5-digit strings."""
    query = f"""
        SELECT zip FROM `{TABLE_ID}`
        WHERE NOT REGEXP_CONTAINS(zip, r'^\\d{{5}}$')
        LIMIT 5
    """
    bad_rows = list(bq_client.query(query).result())
    assert len(bad_rows) == 0, f"Non-5-digit zips found: {[r.zip for r in bad_rows]}"


@pytest.mark.integration
def test_density_idempotent(bq_client):
    """Row count is stable across queries (table is materialized, not volatile)."""
    query = f"SELECT COUNT(*) AS cnt FROM `{TABLE_ID}`"
    count_1 = next(iter(bq_client.query(query).result())).cnt
    count_2 = next(iter(bq_client.query(query).result())).cnt
    assert count_1 == count_2, f"Row counts differ: {count_1} vs {count_2}"


@pytest.mark.integration
def test_density_severity_sum(bq_client):
    """severity_1 + severity_2 + severity_3 + severity_4 == total_count for sampled rows."""
    query = f"""
        SELECT zip, year,
               severity_1_count + severity_2_count + severity_3_count + severity_4_count AS sum_sev,
               total_count
        FROM `{TABLE_ID}`
        WHERE severity_1_count + severity_2_count + severity_3_count + severity_4_count != total_count
        LIMIT 5
    """
    bad_rows = list(bq_client.query(query).result())
    assert len(bad_rows) == 0, f"Severity sum mismatch in {len(bad_rows)} rows"


@pytest.mark.integration
def test_density_weather_count(bq_client):
    """weather_related_count <= total_count for all rows."""
    query = f"""
        SELECT zip, year, weather_related_count, total_count
        FROM `{TABLE_ID}`
        WHERE weather_related_count > total_count
        LIMIT 5
    """
    bad_rows = list(bq_client.query(query).result())
    assert len(bad_rows) == 0, f"weather_related_count > total_count in {len(bad_rows)} rows"
