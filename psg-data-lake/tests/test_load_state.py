"""Integration tests for state_reference table in BigQuery."""

import subprocess
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import DATASET_ID


@pytest.mark.integration
class TestStateReference:
    """Verify state_reference table contents after load."""

    TABLE = f"n8n-workspace-apis.{DATASET_ID}.state_reference"

    def test_row_count(self, bq_client):
        table = bq_client.get_table(self.TABLE)
        assert table.num_rows == 57, f"Expected 57 rows, got {table.num_rows}"

    def test_fips_codes_are_two_char_strings(self, bq_client):
        query = f"SELECT state_fips FROM `{self.TABLE}`"
        rows = list(bq_client.query(query).result())
        for row in rows:
            assert isinstance(row.state_fips, str), f"Expected string, got {type(row.state_fips)}"
            assert len(row.state_fips) == 2, f"Expected 2-char FIPS, got '{row.state_fips}'"

    def test_known_entries(self, bq_client):
        query = f"""
            SELECT state_fips, state_abbr, state_name
            FROM `{self.TABLE}`
            WHERE state_fips IN ('01', '06')
            ORDER BY state_fips
        """
        rows = {row.state_fips: row for row in bq_client.query(query).result()}
        assert rows["01"].state_abbr == "AL"
        assert rows["01"].state_name == "Alabama"
        assert rows["06"].state_abbr == "CA"
        assert rows["06"].state_name == "California"

    def test_idempotency(self, bq_client):
        """Re-running load should not change row count."""
        from load_state_reference import load_state_reference
        count = load_state_reference()
        assert count == 57, f"After re-load: expected 57, got {count}"
