"""Unit tests for vehicle registration source registry."""

from vehicle_sources import (
    ATLAS_EV_HUB_KEY,
    FHWA_MV1_KEY,
    NY_DMV_KEY,
    CA_DMV_KEY,
    get_vehicle_source,
    atlas_ev_hub_states,
    atlas_csv_url,
    prioritized_vehicle_sources,
)


def test_get_vehicle_source_returns_atlas():
    source = get_vehicle_source(ATLAS_EV_HUB_KEY)
    assert source.key == "atlas_ev_hub"
    assert source.geography == "multi_state"
    assert "atlasevhub.com" in source.base_url


def test_get_vehicle_source_returns_fhwa():
    source = get_vehicle_source(FHWA_MV1_KEY)
    assert source.key == "fhwa_mv1"
    assert source.geography == "national"
    assert "datahub.transportation.gov" in source.base_url


def test_get_vehicle_source_raises_on_unknown():
    try:
        get_vehicle_source("nonexistent_source")
        assert False, "Should have raised KeyError"
    except KeyError:
        pass


def test_atlas_ev_hub_states_returns_known_set():
    states = atlas_ev_hub_states()
    assert "NY" in states
    assert "NJ" in states
    assert "CA" not in states
    assert len(states) >= 14


def test_atlas_csv_url_builds_correct_pattern():
    url = atlas_csv_url("NY")
    assert url.startswith("https://www.atlasevhub.com/public/dmv/")
    assert "NY" in url
    assert url.endswith(".csv")


def test_prioritized_vehicle_sources_returns_ordered():
    sources = prioritized_vehicle_sources()
    keys = [s.key for s in sources]
    assert keys.index("atlas_ev_hub") < keys.index("fhwa_mv1")
