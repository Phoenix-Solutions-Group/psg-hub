"""Vehicle registration source registry for PSG data lake."""

from __future__ import annotations

from dataclasses import dataclass


ATLAS_EV_HUB_KEY = "atlas_ev_hub"
FHWA_MV1_KEY = "fhwa_mv1"
NY_DMV_KEY = "ny_dmv"
CA_DMV_KEY = "ca_dmv"

ATLAS_BASE_URL = "https://www.atlasevhub.com/public/dmv/"
FHWA_MV1_ENDPOINT = "https://datahub.transportation.gov/resource/hwtm-7xmz.json"

ATLAS_STATES = {
    "CO", "CT", "ME", "MN", "MT", "NJ", "NM",
    "NY", "NC", "OR", "TN", "TX", "VT", "VA",
}

REGIONS = {
    "northeast": ["NY", "NJ", "CT", "VT", "ME"],
    "southeast": ["NC", "VA", "TN"],
    "midwest": ["MN", "MT"],
    "west": ["CO", "NM", "OR", "TX"],
}


@dataclass(frozen=True)
class VehicleSource:
    key: str
    name: str
    base_url: str
    geography: str
    data_type: str
    granularity: str
    cadence: str
    license_note: str
    adapter_status: str = "planned"
    priority: int = 999


VEHICLE_SOURCES: dict[str, VehicleSource] = {
    ATLAS_EV_HUB_KEY: VehicleSource(
        key=ATLAS_EV_HUB_KEY,
        name="Atlas EV Hub State EV Registration Data",
        base_url=ATLAS_BASE_URL,
        geography="multi_state",
        data_type="ev_only",
        granularity="zip",
        cadence="monthly_snapshot",
        license_note="Open Database License (ODbL 1.0). Attribution required.",
        adapter_status="implementing",
        priority=1,
    ),
    FHWA_MV1_KEY: VehicleSource(
        key=FHWA_MV1_KEY,
        name="FHWA Motor Vehicle Registrations (MV-1)",
        base_url=FHWA_MV1_ENDPOINT,
        geography="national",
        data_type="all_vehicles",
        granularity="state",
        cadence="annual",
        license_note="Public federal data via data.transportation.gov.",
        adapter_status="implementing",
        priority=2,
    ),
    NY_DMV_KEY: VehicleSource(
        key=NY_DMV_KEY,
        name="NY DMV Vehicle Registrations",
        base_url="https://data.ny.gov/resource/w4pv-hbkt.json",
        geography="NY",
        data_type="all_vehicles",
        granularity="zip",
        cadence="snapshot",
        license_note="NY Open Data.",
        adapter_status="implemented",
        priority=10,
    ),
    CA_DMV_KEY: VehicleSource(
        key=CA_DMV_KEY,
        name="California Vehicle Fuel Type Count by ZIP Code",
        base_url="https://data.ca.gov/dataset/vehicle-fuel-type-count-by-zip-code",
        geography="CA",
        data_type="all_vehicles",
        granularity="zip",
        cadence="annual",
        license_note="California Open Data.",
        adapter_status="planned",
        priority=3,
    ),
}


def get_vehicle_source(key: str) -> VehicleSource:
    try:
        return VEHICLE_SOURCES[key]
    except KeyError as error:
        raise KeyError(f"Unknown vehicle source: {key}") from error


def atlas_ev_hub_states() -> set[str]:
    return set(ATLAS_STATES)


ATLAS_LATEST_MONTH = "03"


def atlas_csv_url(state_abbr: str, month: str | None = None) -> str:
    m = month or ATLAS_LATEST_MONTH
    return f"{ATLAS_BASE_URL}{state_abbr}_EV_Registrations_{m}.csv"


def region_states(region: str) -> list[str]:
    region_key = region.lower()
    if region_key not in REGIONS:
        raise KeyError(f"Unknown region: {region}. Available: {sorted(REGIONS)}")
    return REGIONS[region_key]


def prioritized_vehicle_sources() -> list[VehicleSource]:
    return sorted(VEHICLE_SOURCES.values(), key=lambda s: (s.priority, s.key))
