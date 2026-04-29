"""Unit tests for NOAA storm event normalization and aggregation helpers."""

import json
from decimal import Decimal

from storm_events import (
    assign_event_zip,
    event_type_bucket,
    parse_damage_usd,
    parse_ncei_details_index,
    prepare_storm_event_record,
    repair_demand_weight,
    resolve_detail_files,
    storm_zip_monthly_refresh_sql,
)
from storm_sources import canonical_storm_source


def test_parse_ncei_details_index_uses_latest_cycle_per_year():
    source = canonical_storm_source()
    html = """
    <a href="StormEvents_details-ftp_v1.0_d2016_c20250101.csv.gz">old</a>
    <a href="StormEvents_details-ftp_v1.0_d2016_c20260323.csv.gz">new</a>
    <a href="StormEvents_details-ftp_v1.0_d2017_c20260323.csv.gz">next</a>
    """

    files = resolve_detail_files(source, start_year=2016, end_year=2017, index_html=html)

    assert [file.year for file in files] == [2016, 2017]
    assert files[0].cycle == "20260323"
    assert files[0].url.endswith("StormEvents_details-ftp_v1.0_d2016_c20260323.csv.gz")
    assert len(parse_ncei_details_index(html, source)) == 3


def test_prepare_storm_event_record_normalizes_core_noaa_fields():
    row = {
        "EVENT_ID": "12345",
        "EPISODE_ID": "42",
        "EVENT_TYPE": "Hail",
        "BEGIN_DATE_TIME": "07-MAY-19 14:35:00",
        "END_DATE_TIME": "07-MAY-19 14:45:00",
        "STATE": "Texas",
        "STATE_FIPS": "48",
        "YEAR": "2019",
        "BEGIN_YEARMONTH": "201905",
        "MONTH_NAME": "May",
        "CZ_TYPE": "C",
        "CZ_FIPS": "201",
        "CZ_NAME": "Harris",
        "WFO": "HGX",
        "MAGNITUDE": "1.75",
        "MAGNITUDE_TYPE": "E",
        "INJURIES_DIRECT": "1",
        "INJURIES_INDIRECT": "0",
        "DEATHS_DIRECT": "0",
        "DEATHS_INDIRECT": "0",
        "DAMAGE_PROPERTY": "2.5M",
        "DAMAGE_CROPS": "10K",
        "BEGIN_LAT": "29.7604",
        "BEGIN_LON": "-95.3698",
        "END_LAT": "",
        "END_LON": "",
    }

    prepared = prepare_storm_event_record(row, source_year=2019, import_batch_id="batch-1")

    assert prepared["source_event_id"] == 12345
    assert prepared["episode_id"] == 42
    assert prepared["event_type_normalized"] == "hail"
    assert prepared["begin_time"] == "2019-05-07T14:35:00"
    assert prepared["state"] == "TEXAS"
    assert prepared["source_month"] == 5
    assert prepared["cz_fips"] == "201"
    assert prepared["magnitude"] == Decimal("1.75")
    assert prepared["damage_property_usd"] == Decimal("2500000.0")
    assert prepared["damage_crops_usd"] == Decimal("10000")
    assert prepared["begin_location"] == "SRID=4326;POINT(-95.3698 29.7604)"
    assert prepared["repair_demand_weight"] == Decimal("5.0")
    assert json.loads(prepared["raw_payload"])["EVENT_ID"] == "12345"


def test_parse_damage_usd_handles_common_noaa_suffixes():
    assert parse_damage_usd("15K") == Decimal("15000")
    assert parse_damage_usd("1.2M") == Decimal("1200000.0")
    assert parse_damage_usd("0") == Decimal("0")
    assert parse_damage_usd("UNK") is None


def test_weighted_storm_demand_scoring_by_event_type():
    assert event_type_bucket("Hail") == "hail"
    assert repair_demand_weight("Hail") > repair_demand_weight("Thunderstorm Wind")
    assert repair_demand_weight("Thunderstorm Wind") > repair_demand_weight("Flood")
    assert repair_demand_weight("Flood") > repair_demand_weight("Astronomical Low Tide")


def test_assign_event_zip_uses_fixture_geojson_polygon():
    boundaries = [
        {
            "zip_code": "77002",
            "boundary_geojson": {
                "type": "Polygon",
                "coordinates": [[
                    [-96.0, 29.0],
                    [-94.0, 29.0],
                    [-94.0, 31.0],
                    [-96.0, 31.0],
                    [-96.0, 29.0],
                ]],
            },
        }
    ]

    assert assign_event_zip({"begin_lat": 29.7604, "begin_lng": -95.3698}, boundaries) == "77002"
    assert assign_event_zip({"begin_lat": "", "begin_lng": ""}, boundaries) is None
    assert assign_event_zip({"begin_lat": 35.0, "begin_lng": -95.3698}, boundaries) is None


def test_storm_zip_monthly_sql_contains_spatial_join_and_no_accident_truncate():
    sql = storm_zip_monthly_refresh_sql(2016, 2025)

    assert "INSERT INTO storm_zip_monthly" in sql
    assert "ST_Covers(zb.boundary, se.begin_location::geometry)" in sql
    assert "weighted_storm_demand_score" in sql
    assert "__UNMATCHED__" in sql
    assert "unmatched_event_count" in sql
    assert "TRUNCATE accidents" not in sql
