"""Unit tests for Supabase migration helpers."""

import json

from supabase_migration import (
    ACCIDENT_SAMPLE_IDS,
    DENSITY_REFRESH_SQL,
    PII_BIGQUERY_TRANSFERS,
    PUBLIC_SURVEY_RAW_PAYLOAD_REDACT_KEYS,
    decide_accident_import,
    prepare_accident_record,
    prepare_boundary_record,
    prepare_hf_accident_record,
    row_values,
    sanitize_identifier,
    sanitize_relation,
)
from accident_sources import canonical_accident_source


def test_prepare_accident_record_normalizes_zip_and_booleans():
    row = {
        "id": "A-1",
        "zipcode": "501-1234",
        "severity": "3",
        "traffic_signal": "True",
        "distance_mi": "1.25",
    }

    prepared = prepare_accident_record(row)

    assert prepared["zipcode"] == "00501"
    assert prepared["traffic_signal"] is True
    assert prepared["severity"] == "3"
    assert prepared["distance_mi"] == "1.25"
    assert json.loads(prepared["raw_payload"]) == row


def test_prepare_boundary_record_stages_geojson_jsonb():
    row = {
        "zip_code": "85001",
        "state_fips": "04",
        "boundary_geo": '{"type":"MultiPolygon","coordinates":[]}',
    }

    prepared = prepare_boundary_record(row)

    assert prepared["zip_code"] == "85001"
    assert "boundary_geo" not in prepared
    assert json.loads(prepared["boundary_geojson"]) == {
        "type": "MultiPolygon",
        "coordinates": [],
    }


def test_density_refresh_sql_targets_supabase_tables():
    assert "INSERT INTO accident_density" in DENSITY_REFRESH_SQL
    assert "FROM accidents" in DENSITY_REFRESH_SQL
    assert "COUNT(*) FILTER" in DENSITY_REFRESH_SQL


def test_sanitize_identifier_rejects_sql_fragments():
    assert sanitize_identifier("survey_responses") == "survey_responses"

    try:
        sanitize_identifier("survey_responses; drop table shops")
    except ValueError as error:
        assert "Unsafe SQL identifier" in str(error)
    else:
        raise AssertionError("unsafe identifier was accepted")


def test_sanitize_relation_allows_known_sensitive_tables_only():
    assert sanitize_relation("sensitive.survey_pii") == "sensitive.survey_pii"
    assert sanitize_relation("sensitive.repair_customer_locations") == "sensitive.repair_customer_locations"

    try:
        sanitize_relation("sensitive.survey_pii; drop schema sensitive")
    except ValueError as error:
        assert "Unsupported table" in str(error)
    else:
        raise AssertionError("unsafe relation was accepted")


def test_pii_transfers_are_private_schema_only():
    transfer_tables = {transfer["table"] for transfer in PII_BIGQUERY_TRANSFERS}

    assert transfer_tables == {
        "sensitive.survey_pii",
        "sensitive.repair_customers",
    }


def test_row_values_redacts_public_survey_raw_payload_keys():
    row = {
        "shop_name": "Example Shop",
        "raw_payload": json.dumps(
            {
                "match_key": "match-1",
                "sq_referral_agent": "Example Agent",
                "text_customer_comments": "Dashboard-visible comment",
            }
        ),
    }

    values = row_values(
        row,
        ["shop_name", "raw_payload"],
        PUBLIC_SURVEY_RAW_PAYLOAD_REDACT_KEYS,
    )

    assert values[0] == "Example Shop"
    payload = json.loads(values[1])
    assert payload == {"match_key": "match-1"}


def test_prepare_hf_accident_record_normalizes_columns_and_location():
    row = {
        "ID": "A-1",
        "Source": "Source2",
        "Severity": 3,
        "Start_Time": "2016-02-08 05:46:00",
        "Start_Lat": 39.865147,
        "Start_Lng": -84.058723,
        "Zipcode": "45424-1234",
        "Traffic_Signal": False,
        "Distance(mi)": 0.01,
        "Humidity(%)": 91.0,
    }

    prepared = prepare_hf_accident_record(row, import_batch_id="batch-1")

    assert prepared["id"] == "A-1"
    assert prepared["source"] == "Source2"
    assert prepared["zipcode"] == "45424"
    assert prepared["distance_mi"] == "0.01"
    assert prepared["humidity_pct"] == "91.0"
    assert prepared["traffic_signal"] is False
    assert prepared["location"] == "SRID=4326;POINT(-84.058723 39.865147)"
    assert prepared["import_batch_id"] == "batch-1"
    assert json.loads(prepared["raw_payload"])["ID"] == "A-1"


def test_decide_accident_import_empty_table_loads():
    assert decide_accident_import(0, 0, len(ACCIDENT_SAMPLE_IDS), canonical_accident_source()) == "load"


def test_decide_accident_import_complete_matching_table_skips():
    source = canonical_accident_source()

    assert (
        decide_accident_import(
            source.expected_row_count,
            len(ACCIDENT_SAMPLE_IDS),
            len(ACCIDENT_SAMPLE_IDS),
            source,
        )
        == "skip"
    )


def test_decide_accident_import_partial_table_blocks_append():
    source = canonical_accident_source()

    assert (
        decide_accident_import(
            source.expected_row_count - 1,
            len(ACCIDENT_SAMPLE_IDS),
            len(ACCIDENT_SAMPLE_IDS),
            source,
        )
        == "blocked_partial_existing"
    )


def test_decide_accident_import_complete_mismatched_table_blocks():
    source = canonical_accident_source()

    assert (
        decide_accident_import(
            source.expected_row_count,
            0,
            len(ACCIDENT_SAMPLE_IDS),
            source,
        )
        == "blocked_existing_mismatch"
    )
