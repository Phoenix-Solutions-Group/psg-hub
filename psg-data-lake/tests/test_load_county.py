"""Integration tests for county_reference table in BigQuery."""

import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import DATASET_ID


@pytest.mark.integration
class TestCountyReference:
    """Verify county_reference table contents after load."""

    TABLE = f"n8n-workspace-apis.{DATASET_ID}.county_reference"

    def test_row_count(self, bq_client):
        table = bq_client.get_table(self.TABLE)
        assert table.num_rows == 3235, f"Expected 3235 rows, got {table.num_rows}"

    def test_county_fips_codes_are_five_char_strings(self, bq_client):
        query = f"SELECT county_fips FROM `{self.TABLE}`"
        rows = list(bq_client.query(query).result())
        for row in rows:
            assert isinstance(row.county_fips, str), f"Expected string, got {type(row.county_fips)}"
            assert len(row.county_fips) == 5, f"Expected 5-char FIPS, got '{row.county_fips}'"

    def test_state_fips_codes_are_two_char_strings(self, bq_client):
        query = f"SELECT DISTINCT state_fips FROM `{self.TABLE}`"
        rows = list(bq_client.query(query).result())
        for row in rows:
            assert isinstance(row.state_fips, str), f"Expected string, got {type(row.state_fips)}"
            assert len(row.state_fips) == 2, f"Expected 2-char state FIPS, got '{row.state_fips}'"

    def test_known_entry(self, bq_client):
        query = f"""
            SELECT county_fips, state_abbr, county_name, state_fips
            FROM `{self.TABLE}`
            WHERE county_fips = '01001'
        """
        rows = list(bq_client.query(query).result())
        assert len(rows) == 1
        row = rows[0]
        assert row.state_abbr == "AL"
        assert "Autauga" in row.county_name
        assert row.state_fips == "01"
