"""Shared test fixtures for PSG Data Lake."""

import sys
import os
import pytest

# Ensure project root is on sys.path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def bq_client():
    """Return an authenticated BigQuery client (integration tests only)."""
    from utils import get_client
    return get_client()


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line("markers", "integration: requires live BigQuery access")
