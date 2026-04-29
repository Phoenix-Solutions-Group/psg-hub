"""Unit tests for storm source registry metadata."""

from storm_sources import CANONICAL_STORM_SOURCE_KEY, canonical_storm_source, get_storm_source


def test_canonical_storm_source_metadata():
    source = canonical_storm_source()

    assert source.key == CANONICAL_STORM_SOURCE_KEY
    assert source.bulk_csv_base_url == "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
    assert source.csv_file_families == ("details", "fatalities", "locations")
    assert source.details_file_pattern(2016, "20260323") == (
        "StormEvents_details-ftp_v1.0_d2016_c20260323.csv.gz"
    )
    assert "public" in source.license_note.lower()
    assert source.supplemental_geo_url == "https://origin-west-www-spc.woc.noaa.gov/gis/svrgis/"


def test_get_storm_source_rejects_unknown_key():
    try:
        get_storm_source("not-a-source")
    except KeyError as error:
        assert "Unknown storm source" in str(error)
    else:
        raise AssertionError("unknown storm source was accepted")
