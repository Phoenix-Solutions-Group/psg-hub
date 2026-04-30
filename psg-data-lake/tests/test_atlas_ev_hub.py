"""Unit tests for Atlas EV Hub ETL."""

import json

from atlas_ev_hub import (
    prepare_ev_registration_record,
    atlas_csv_url_for_state,
    inspect_source_info,
)


def test_prepare_ev_registration_record_normalizes_fields():
    row = {
        "State": "NY",
        "ZIP Code": "10001",
        "Registration Date": "2024-06-15",
        "Vehicle Make": "TESLA",
        "Vehicle Model": "MODEL 3",
        "Powertrain Type": "BEV",
        "Vehicle Category": "Passenger",
        "Vehicle Count": "12",
        "DMV Snapshot Date": "2024-07-01",
    }

    prepared = prepare_ev_registration_record(row, snapshot_date="2024-07-01", import_batch_id="batch-1")

    assert prepared is not None
    assert prepared["zip"] == "10001"
    assert prepared["state"] == "NY"
    assert prepared["vehicle_count"] == 12
    assert prepared["make"] == "TESLA"
    assert prepared["model"] == "MODEL 3"
    assert prepared["powertrain_type"] == "BEV"
    assert prepared["vehicle_category"] == "Passenger"
    assert prepared["snapshot_date"] == "2024-07-01"
    assert prepared["source"] == "atlas_ev_hub"
    assert prepared["import_batch_id"] == "batch-1"
    assert json.loads(prepared["raw_payload"])["Vehicle Make"] == "TESLA"


def test_prepare_ev_registration_record_rejects_missing_zip():
    row = {"State": "NY", "ZIP Code": "", "Vehicle Count": "5"}
    assert prepare_ev_registration_record(row, snapshot_date="2024-07-01") is None


def test_prepare_ev_registration_record_rejects_zero_count():
    row = {"State": "NY", "ZIP Code": "10001", "Vehicle Count": "0"}
    assert prepare_ev_registration_record(row, snapshot_date="2024-07-01") is None


def test_prepare_ev_registration_record_handles_zip_plus_4():
    row = {"State": "NJ", "ZIP Code": "07030-1234", "Vehicle Count": "8"}
    prepared = prepare_ev_registration_record(row, snapshot_date="2024-07-01")
    assert prepared is not None
    assert prepared["zip"] == "07030"


def test_prepare_ev_registration_record_handles_short_zip():
    row = {"State": "CT", "ZIP Code": "6510", "Vehicle Count": "3"}
    prepared = prepare_ev_registration_record(row, snapshot_date="2024-07-01")
    assert prepared is not None
    assert prepared["zip"] == "06510"


def test_prepare_ev_registration_record_handles_actual_csv_columns():
    row = {
        "State": "NY",
        "ZIP Code": "10805",
        "Registration Date": "12/1/2018",
        "Vehicle Make": "TESLA",
        "Vehicle Model": "MODEL 3",
        "Vehicle Model Year": "2018",
        "Drivetrain Type": "BEV",
        "Vehicle GVWR Class": "1",
        "Vehicle GVWR Category": "Light-Duty (Class 1-2A)",
        "Vehicle Count": "1",
        "DMV Snapshot ID": "33",
        "DMV Snapshot (Date)": "DMV Snapshot (12/2/2019)",
        "Latest DMV Snapshot Flag": "True",
    }
    prepared = prepare_ev_registration_record(row, snapshot_date="2024-07-01")
    assert prepared is not None
    assert prepared["powertrain_type"] == "BEV"
    assert prepared["vehicle_category"] == "Light-Duty (Class 1-2A)"


def test_atlas_csv_url_for_state_builds_correct_url():
    url = atlas_csv_url_for_state("NY")
    assert "atlasevhub.com" in url
    assert "NY" in url
    assert "_03.csv" in url


def test_inspect_source_info_returns_metadata():
    info = inspect_source_info()
    assert info["source"]["key"] == "atlas_ev_hub"
    assert "NY" in info["available_states"]
    assert len(info["regions"]) >= 4
