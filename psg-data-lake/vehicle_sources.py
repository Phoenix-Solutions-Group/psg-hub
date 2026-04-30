"""Vehicle registration source registry for PSG data lake."""

from __future__ import annotations

from dataclasses import dataclass


ATLAS_EV_HUB_KEY = "atlas_ev_hub"
FHWA_MV1_KEY = "fhwa_mv1"
NY_DMV_KEY = "ny_dmv"
CA_DMV_KEY = "ca_dmv"
CENSUS_VEHICLES_KEY = "acs5_zcta_vehicles"
TX_DMV_KEY = "tx_dmv"
MD_MVA_KEY = "md_mva"
WA_DOL_KEY = "wa_dol"

ATLAS_BASE_URL = "https://www.atlasevhub.com/public/dmv/"
FHWA_MV1_ENDPOINT = "https://datahub.transportation.gov/resource/hwtm-7xmz.json"
CA_CKAN_API = "https://data.ca.gov/api/3/action/datastore_search_sql"

CA_RESOURCE_IDS: dict[int, str] = {
    2023: "d599c3d3-87af-4e8c-8694-9c01f49e3d93",
    2024: "66b0121e-5eab-4fcf-aa0d-2b1dfb5510ab",
    2025: "b459d957-5d94-4b10-999d-770419870364",
}

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
        base_url=CA_CKAN_API,
        geography="CA",
        data_type="all_vehicles",
        granularity="zip",
        cadence="annual",
        license_note="California Open Data.",
        adapter_status="implementing",
        priority=3,
    ),
    CENSUS_VEHICLES_KEY: VehicleSource(
        key=CENSUS_VEHICLES_KEY,
        name="Census ACS5 Household Vehicle Availability (B25046/B25044)",
        base_url="https://api.census.gov/data/{year}/acs/acs5",
        geography="national",
        data_type="household_vehicles",
        granularity="zcta",
        cadence="annual",
        license_note="Public federal data via Census Bureau API.",
        adapter_status="implemented",
        priority=0,
    ),
    TX_DMV_KEY: VehicleSource(
        key=TX_DMV_KEY,
        name="Texas DMV Registered Vehicles by County",
        base_url="https://data.texas.gov/resource/j5fk-64au.json",
        geography="TX",
        data_type="all_vehicles",
        granularity="county",
        cadence="monthly",
        license_note="Texas Open Data.",
        adapter_status="implemented",
        priority=4,
    ),
    MD_MVA_KEY: VehicleSource(
        key=MD_MVA_KEY,
        name="Maryland MVA Vehicle Registrations by County",
        base_url="https://opendata.maryland.gov/resource/db8v-9ewn.json",
        geography="MD",
        data_type="all_vehicles",
        granularity="county",
        cadence="monthly",
        license_note="Maryland Open Data.",
        adapter_status="implemented",
        priority=5,
    ),
    WA_DOL_KEY: VehicleSource(
        key=WA_DOL_KEY,
        name="Washington DOL Vehicle Registrations by Class and County",
        base_url="https://data.wa.gov/resource/hmzg-s6q4.json",
        geography="WA",
        data_type="all_vehicles",
        granularity="county",
        cadence="quarterly",
        license_note="Washington Open Data.",
        adapter_status="implemented",
        priority=6,
    ),
}


def get_vehicle_source(key: str) -> VehicleSource:
    try:
        return VEHICLE_SOURCES[key]
    except KeyError as error:
        raise KeyError(f"Unknown vehicle source: {key}") from error


def atlas_ev_hub_states() -> set[str]:
    return set(ATLAS_STATES)


ATLAS_STATE_MONTHS: dict[str, str | None] = {
    "CO": "03",
    "CT": "03",
    "ME": "09",
    "MN": "11",
    "MT": "05",
    "NC": None,
    "NJ": "12",
    "NM": "03",
    "NY": "03",
    "OR": "02",
    "TN": "11",
    "TX": "03",
    "VA": "05",
    "VT": "11",
}


def atlas_csv_url(state_abbr: str, month: str | None = None) -> str:
    m = month or ATLAS_STATE_MONTHS.get(state_abbr, "03")
    if m is None:
        return f"{ATLAS_BASE_URL}{state_abbr}_EV_Registrations.csv"
    return f"{ATLAS_BASE_URL}{state_abbr}_EV_Registrations_{m}.csv"


def region_states(region: str) -> list[str]:
    region_key = region.lower()
    if region_key not in REGIONS:
        raise KeyError(f"Unknown region: {region}. Available: {sorted(REGIONS)}")
    return REGIONS[region_key]


def prioritized_vehicle_sources() -> list[VehicleSource]:
    return sorted(VEHICLE_SOURCES.values(), key=lambda s: (s.priority, s.key))
