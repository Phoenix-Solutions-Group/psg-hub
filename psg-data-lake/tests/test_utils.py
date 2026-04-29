"""Unit tests for normalization utilities."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.normalize import normalize_zip, normalize_fips


class TestNormalizeZip:
    def test_none_returns_none(self):
        assert normalize_zip(None) is None

    def test_empty_string_returns_none(self):
        assert normalize_zip("") is None

    def test_valid_five_digit(self):
        assert normalize_zip("85001") == "85001"

    def test_short_zip_zero_padded(self):
        assert normalize_zip("501") == "00501"

    def test_zip_plus_four_strips_suffix(self):
        assert normalize_zip("85001-1234") == "85001"

    def test_integer_input_zero_padded(self):
        assert normalize_zip(501) == "00501"

    def test_whitespace_stripped(self):
        assert normalize_zip("  85001  ") == "85001"


class TestNormalizeFips:
    def test_state_fips_zero_padded(self):
        assert normalize_fips("1", 2) == "01"

    def test_county_fips_already_correct(self):
        assert normalize_fips("01001", 5) == "01001"

    def test_none_returns_none(self):
        assert normalize_fips(None, 2) is None

    def test_empty_returns_none(self):
        assert normalize_fips("", 5) is None

    def test_integer_input(self):
        assert normalize_fips(4, 2) == "04"
