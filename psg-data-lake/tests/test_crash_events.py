"""Unit tests for official crash event adapters."""

import json
from decimal import Decimal

from crash_events import (
    chicago_api_url,
    crash_zip_annual_refresh_sql,
    inspect_crash_sources,
    prepare_chicago_crash_record,
)


def test_chicago_api_url_filters_year_range_and_fields():
    url = chicago_api_url(start_year=2024, end_year=2025, limit=100, offset=200)

    assert "85ca-t3if.json" in url
    assert "%24limit=100" in url
    assert "%24offset=200" in url
    assert "crash_date+%3E%3D+%272024-01-01T00%3A00%3A00%27" in url
    assert "crash_date+%3C+%272026-01-01T00%3A00%3A00%27" in url


def test_prepare_chicago_crash_record_normalizes_targeting_fields():
    row = {
        "crash_record_id": "abc123",
        "crash_date": "2025-04-27T22:55:00.000",
        "date_police_notified": "2025-04-27T23:56:00.000",
        "crash_type": "INJURY AND / OR TOW DUE TO CRASH",
        "damage": "OVER $1,500",
        "weather_condition": "RAIN",
        "roadway_surface_cond": "WET",
        "first_crash_type": "REAR END",
        "prim_contributory_cause": "FOLLOWING TOO CLOSELY",
        "num_units": "2",
        "injuries_total": "1",
        "injuries_fatal": "0",
        "injuries_incapacitating": "0",
        "latitude": "41.7659190113",
        "longitude": "-87.6627761566",
    }

    prepared = prepare_chicago_crash_record(row, import_batch_id="batch-1")

    assert prepared["source"] == "chicago_traffic_crashes"
    assert prepared["source_event_id"] == "abc123"
    assert prepared["event_time"] == "2025-04-27T22:55:00"
    assert prepared["reported_time"] == "2025-04-27T23:56:00"
    assert prepared["state"] == "IL"
    assert prepared["city"] == "Chicago"
    assert prepared["severity"] == "injury"
    assert prepared["injuries_total"] == 1
    assert prepared["vehicles_involved"] == 2
    assert prepared["location"] == "SRID=4326;POINT(-87.6627761566 41.7659190113)"
    assert prepared["confidence_score"] == Decimal("0.95")
    assert json.loads(prepared["raw_payload"])["crash_record_id"] == "abc123"


def test_prepare_chicago_crash_record_classifies_fatal_and_missing_location():
    prepared = prepare_chicago_crash_record({
        "crash_record_id": "fatal-1",
        "injuries_fatal": "1",
    })

    assert prepared["severity"] == "fatal"
    assert prepared["location"] is None
    assert prepared["confidence_score"] == Decimal("0.70")


def test_crash_zip_annual_sql_contains_spatial_join_and_unmatched_bucket():
    sql = crash_zip_annual_refresh_sql(2024, 2025)

    assert "INSERT INTO crash_zip_annual" in sql
    assert "ST_Covers(zb.boundary, ce.location::geometry)" in sql
    assert "weighted_crash_demand_score" in sql
    assert "__UNMATCHED__" in sql
    assert "TRUNCATE accidents" not in sql


def test_inspect_crash_sources_reports_next_free_source():
    result = inspect_crash_sources()

    assert result["next_recommended_source"]["key"] == "colorado_cdot_crash_listing"
    assert [source["key"] for source in result["sources"][:3]] == [
        "colorado_cdot_crash_listing",
        "nyc_motor_vehicle_collisions",
        "missouri_modot_mshp_crash_references",
    ]
