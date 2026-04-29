"""Cross-table zip format validation (REF-05 integration test).

Confirms all zip_code columns across all tables in psg_geo_data
are normalized to 5-digit zero-padded STRING format.
"""

import pytest

pytestmark = pytest.mark.integration

TABLES_WITH_ZIP = [
    "psg_geo_data.zip_reference",
    "psg_geo_data.zcta_zip_mapping",
]


@pytest.mark.parametrize("table", TABLES_WITH_ZIP)
def test_zip_format_across_tables(bq_client, table):
    """Every zip_code in {table} must be exactly 5 digits, no exceptions."""
    query = f"""
        SELECT COUNT(*) as n
        FROM {table}
        WHERE LENGTH(zip_code) != 5
           OR REGEXP_CONTAINS(zip_code, r'[^0-9]')
    """
    rows = list(bq_client.query(query).result())
    assert rows[0].n == 0, (
        f"Found {rows[0].n} malformed zip codes in {table}"
    )
