"""Unit tests for FHWA MV-1 state registration ETL."""

import json

from fhwa_registrations import (
    prepare_state_registration_record,
    fhwa_api_url,
    inspect_source_info,
)


def test_prepare_state_registration_record_normalizes_fields():
    row = {
        "year": "2023",
        "state": "New York",
        "auto": "8200000",
        "bus": "45000",
        "truck": "2100000",
        "motorcycle": "320000",
    }

    prepared = prepare_state_registration_record(row, import_batch_id="batch-1")

    assert prepared is not None
    assert prepared["state"] == "New York"
    assert prepared["year"] == 2023
    assert prepared["auto_count"] == 8200000
    assert prepared["bus_count"] == 45000
    assert prepared["truck_count"] == 2100000
    assert prepared["motorcycle_count"] == 320000
    assert prepared["source"] == "fhwa_mv1"
    assert prepared["import_batch_id"] == "batch-1"
    assert json.loads(prepared["raw_payload"])["state"] == "New York"


def test_prepare_state_registration_record_handles_missing_values():
    row = {"year": "2020", "state": "Alaska", "auto": "", "bus": "0", "truck": "", "motorcycle": ""}
    prepared = prepare_state_registration_record(row)
    assert prepared is not None
    assert prepared["auto_count"] is None
    assert prepared["bus_count"] == 0


def test_prepare_state_registration_record_rejects_missing_state():
    row = {"year": "2023", "state": "", "auto": "100"}
    assert prepare_state_registration_record(row) is None


def test_prepare_state_registration_record_rejects_missing_year():
    row = {"year": "", "state": "Texas", "auto": "100"}
    assert prepare_state_registration_record(row) is None


def test_fhwa_api_url_includes_year_filter():
    url = fhwa_api_url(start_year=2020, end_year=2023, limit=5000)
    assert "hwtm-7xmz.json" in url
    assert "2020" in url
    assert "2023" in url
    assert "5000" in url


def test_inspect_source_info_returns_metadata():
    info = inspect_source_info()
    assert info["source"]["key"] == "fhwa_mv1"
    assert "datahub.transportation.gov" in info["endpoint"]
