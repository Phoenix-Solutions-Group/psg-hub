"""Unit tests for Census income loader helpers."""

from decimal import Decimal

from census_income import inspect_source, parse_decimal, parse_int, prepare_income_record


def test_parse_helpers_handle_nulls_and_numbers():
    assert parse_int("123") == 123
    assert parse_int("") is None
    assert parse_int("null") is None
    assert parse_decimal("12345.5") == Decimal("12345.5")
    assert parse_decimal("null") is None


def test_prepare_income_record_computes_mean_from_aggregate_and_households():
    row = {
        "NAME": "ZCTA5 11501",
        "B11001_001E": "100",
        "B19013_001E": "120000",
        "B19025_001E": "15000000",
        "zip code tabulation area": "11501",
    }

    prepared = prepare_income_record(row, year=2023)

    assert prepared is not None
    assert prepared["zip"] == "11501"
    assert prepared["year"] == 2023
    assert prepared["households"] == 100
    assert prepared["aggregate_household_income"] == Decimal("15000000")
    assert prepared["mean_household_income"] == Decimal("150000")
    assert prepared["median_household_income"] == Decimal("120000")


def test_prepare_income_record_rejects_missing_zip():
    row = {
        "NAME": "Unknown",
        "B11001_001E": "100",
        "B19013_001E": "120000",
        "B19025_001E": "15000000",
        "zip code tabulation area": "",
    }
    assert prepare_income_record(row, year=2023) is None


def test_inspect_source_returns_endpoint_and_query():
    result = inspect_source(2023)
    assert result["year"] == 2023
    assert "api.census.gov/data/2023/acs/acs5" in result["endpoint"]
    assert "zip+code+tabulation+area%3A%2A" in result["example_query"]

