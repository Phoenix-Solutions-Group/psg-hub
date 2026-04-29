"""Unit tests for BigQuery schema definitions."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.schemas import (
    ZIP_REFERENCE_SCHEMA,
    ZCTA_ZIP_SCHEMA,
    STATE_REFERENCE_SCHEMA,
    COUNTY_REFERENCE_SCHEMA,
)


class TestZipReferenceSchema:
    def test_field_count(self):
        assert len(ZIP_REFERENCE_SCHEMA) == 3

    def test_all_fields_have_names(self):
        for field in ZIP_REFERENCE_SCHEMA:
            assert field.name is not None
            assert isinstance(field.name, str)

    def test_required_fields(self):
        for field in ZIP_REFERENCE_SCHEMA:
            assert field.mode == "REQUIRED"


class TestZctaZipSchema:
    def test_field_count(self):
        assert len(ZCTA_ZIP_SCHEMA) == 8

    def test_all_fields_have_names(self):
        for field in ZCTA_ZIP_SCHEMA:
            assert field.name is not None
            assert isinstance(field.name, str)

    def test_zip_code_required(self):
        zip_field = [f for f in ZCTA_ZIP_SCHEMA if f.name == "zip_code"][0]
        assert zip_field.mode == "REQUIRED"

    def test_nullable_fields(self):
        nullable_names = {"reporting_year", "zip_type", "city_name", "state_name",
                          "state_abbr", "enc_zip", "zcta"}
        for field in ZCTA_ZIP_SCHEMA:
            if field.name in nullable_names:
                assert field.mode == "NULLABLE"


class TestStateReferenceSchema:
    def test_field_count(self):
        assert len(STATE_REFERENCE_SCHEMA) == 3

    def test_all_fields_have_names(self):
        for field in STATE_REFERENCE_SCHEMA:
            assert field.name is not None
            assert isinstance(field.name, str)

    def test_all_required(self):
        for field in STATE_REFERENCE_SCHEMA:
            assert field.mode == "REQUIRED"


class TestCountyReferenceSchema:
    def test_field_count(self):
        assert len(COUNTY_REFERENCE_SCHEMA) == 4

    def test_all_fields_have_names(self):
        for field in COUNTY_REFERENCE_SCHEMA:
            assert field.name is not None
            assert isinstance(field.name, str)

    def test_all_required(self):
        for field in COUNTY_REFERENCE_SCHEMA:
            assert field.mode == "REQUIRED"

    def test_field_names(self):
        names = [f.name for f in COUNTY_REFERENCE_SCHEMA]
        assert "county_fips" in names
        assert "state_abbr" in names
        assert "county_name" in names
        assert "state_fips" in names
