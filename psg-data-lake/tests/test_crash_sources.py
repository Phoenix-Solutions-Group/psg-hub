"""Unit tests for crash source registry metadata."""

from crash_sources import (
    CALIFORNIA_CCRS_TIMS_KEY,
    CHICAGO_TRAFFIC_CRASHES_KEY,
    COLORADO_CDOT_CRASHES_KEY,
    MISSOURI_CRASH_REFERENCES_KEY,
    NYC_MOTOR_VEHICLE_COLLISIONS_KEY,
    get_crash_source,
    prioritized_crash_sources,
)


def test_chicago_crash_source_metadata():
    source = get_crash_source()

    assert source.key == CHICAGO_TRAFFIC_CRASHES_KEY
    assert source.api_url == "https://data.cityofchicago.org/resource/85ca-t3if.json"
    assert source.geography == "Chicago, IL"
    assert "Public" in source.license_note


def test_unknown_crash_source_rejected():
    try:
        get_crash_source("missing")
    except KeyError as error:
        assert "Unknown crash source" in str(error)
    else:
        raise AssertionError("unknown crash source was accepted")


def test_prioritized_free_crash_sources_follow_psg_market_order():
    keys = [source.key for source in prioritized_crash_sources()]

    assert keys[:4] == [
        COLORADO_CDOT_CRASHES_KEY,
        NYC_MOTOR_VEHICLE_COLLISIONS_KEY,
        MISSOURI_CRASH_REFERENCES_KEY,
        CALIFORNIA_CCRS_TIMS_KEY,
    ]
    assert CHICAGO_TRAFFIC_CRASHES_KEY in keys


def test_colorado_source_is_validated_before_paid_feeds():
    source = get_crash_source(COLORADO_CDOT_CRASHES_KEY)

    assert source.geography == "Colorado statewide"
    assert source.adapter_status == "source_validated"
    assert "codot.gov" in source.source_url
    assert "2025" in source.update_cadence
