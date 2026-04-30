"""Unit tests for CA DMV vehicle registration ETL (CKAN API)."""

from ca_dmv_registrations import (
    prepare_ca_registration_record,
    build_aggregation_sql,
    inspect_source_info,
)


def test_prepare_record_normalizes_fields():
    row = {
        "ZIP Code": "90210",
        "total_vehicles": "12500",
        "passenger_vehicles": "11000",
        "commercial_vehicles": "1500",
    }
    prepared = prepare_ca_registration_record(row, snapshot_date="2024-12-31")
    assert prepared is not None
    assert prepared["zip"] == "90210"
    assert prepared["vehicle_count"] == 12500
    assert prepared["passenger_count"] == 11000
    assert prepared["commercial_count"] == 1500
    assert prepared["snapshot_date"] == "2024-12-31"
    assert prepared["source"] == "ca_dmv"


def test_prepare_record_rejects_oos():
    row = {"ZIP Code": "OOS", "total_vehicles": "637834"}
    assert prepare_ca_registration_record(row, snapshot_date="2024-12-31") is None


def test_prepare_record_rejects_empty_zip():
    row = {"ZIP Code": "", "total_vehicles": "100"}
    assert prepare_ca_registration_record(row, snapshot_date="2024-12-31") is None


def test_prepare_record_rejects_none_zip():
    row = {"ZIP Code": None, "total_vehicles": "100"}
    assert prepare_ca_registration_record(row, snapshot_date="2024-12-31") is None


def test_prepare_record_rejects_zero_count():
    row = {"ZIP Code": "90210", "total_vehicles": "0"}
    assert prepare_ca_registration_record(row, snapshot_date="2024-12-31") is None


def test_prepare_record_handles_zip_plus_4():
    row = {"ZIP Code": "90210-1234", "total_vehicles": "50"}
    prepared = prepare_ca_registration_record(row, snapshot_date="2024-12-31")
    assert prepared is not None
    assert prepared["zip"] == "90210"


def test_prepare_record_pads_short_zip():
    row = {"ZIP Code": "1234", "total_vehicles": "50"}
    prepared = prepare_ca_registration_record(row, snapshot_date="2024-12-31")
    assert prepared is not None
    assert prepared["zip"] == "01234"


def test_prepare_record_handles_missing_passenger_commercial():
    row = {"ZIP Code": "90210", "total_vehicles": "500"}
    prepared = prepare_ca_registration_record(row, snapshot_date="2024-12-31")
    assert prepared is not None
    assert prepared["passenger_count"] is None
    assert prepared["commercial_count"] is None


def test_build_aggregation_sql_filters_non_numeric_zips():
    sql = build_aggregation_sql("test-resource-id")
    assert "test-resource-id" in sql
    assert "ZIP Code" in sql
    assert "'^[0-9]'" in sql
    assert "GROUP BY" in sql
    assert "SUM" in sql


def test_build_aggregation_sql_maps_duty():
    sql = build_aggregation_sql("test-resource-id")
    assert "Light" in sql
    assert "Heavy" in sql
    assert "passenger_vehicles" in sql
    assert "commercial_vehicles" in sql


def test_inspect_source_info_returns_metadata():
    info = inspect_source_info()
    assert info["source"]["key"] == "ca_dmv"
    assert "resource_ids" in info
    assert 2024 in info["resource_ids"] or "2024" in info["resource_ids"]
