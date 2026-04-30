"""Crash-event source registry for PSG market demand adapters."""

from __future__ import annotations

from dataclasses import dataclass


CHICAGO_TRAFFIC_CRASHES_KEY = "chicago_traffic_crashes"
COLORADO_CDOT_CRASHES_KEY = "colorado_cdot_crash_listing"
NYC_MOTOR_VEHICLE_COLLISIONS_KEY = "nyc_motor_vehicle_collisions"
MISSOURI_CRASH_REFERENCES_KEY = "missouri_modot_mshp_crash_references"
CALIFORNIA_CCRS_TIMS_KEY = "california_ccrs_tims"
FARS_CRASHES_KEY = "fars_crashes"
FARS_CRASHES_API_BASE = "https://crashviewer.nhtsa.dot.gov/CrashAPI"
FARS_CRASHES_LANDING_URL = "https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars"
CHICAGO_TRAFFIC_CRASHES_DATASET_ID = "85ca-t3if"
CHICAGO_TRAFFIC_CRASHES_ENDPOINT = "https://data.cityofchicago.org/resource/85ca-t3if.json"
CHICAGO_TRAFFIC_CRASHES_LANDING_URL = "https://data.cityofchicago.org/d/85ca-t3if"
COLORADO_CDOT_CRASHES_LANDING_URL = "https://www.codot.gov/safety/traffic-safety/data-analysis/crash-data"
NYC_MOTOR_VEHICLE_COLLISIONS_DATASET_ID = "h9gi-nx95"
NYC_MOTOR_VEHICLE_COLLISIONS_ENDPOINT = "https://data.cityofnewyork.us/resource/h9gi-nx95.json"
NYC_MOTOR_VEHICLE_COLLISIONS_LANDING_URL = "https://data.cityofnewyork.us/d/h9gi-nx95"
MISSOURI_MODOT_CRASH_DASHBOARD_URL = "https://www.modot.org/missouris-traffic-crash-dashboard"
MISSOURI_MSHP_CRASH_DATA_URL = "https://www.mshp.dps.missouri.gov/MSHPWeb/SAC/crash_data_960grid.html"
CALIFORNIA_CCRS_URL = "https://www.chp.ca.gov/programs-services/services-information/switrs-statewide-integrated-traffic-records-system/"
CALIFORNIA_TIMS_URL = "https://tims.berkeley.edu/help/Query_and_Map.php"


@dataclass(frozen=True)
class CrashSource:
    key: str
    name: str
    source_url: str
    api_url: str
    geography: str
    update_cadence: str
    license_note: str
    expected_lag: str
    notes: str = ""
    adapter_status: str = "planned"
    priority: int = 999


CRASH_SOURCES: dict[str, CrashSource] = {
    CHICAGO_TRAFFIC_CRASHES_KEY: CrashSource(
        key=CHICAGO_TRAFFIC_CRASHES_KEY,
        name="City of Chicago Traffic Crashes - Crashes",
        source_url=CHICAGO_TRAFFIC_CRASHES_LANDING_URL,
        api_url=CHICAGO_TRAFFIC_CRASHES_ENDPOINT,
        geography="Chicago, IL",
        update_cadence="Continuous as finalized/amended crash reports reach the Chicago Data Portal",
        license_note=(
            "Public City of Chicago open data. The dataset excludes personally identifiable "
            "information; preserve source attribution and terms."
        ),
        expected_lag="Report finalization/amendment lag; suitable for annual and monthly trend analysis.",
        notes=(
            "First official recent-crash adapter because Illinois is PSG's top current "
            "client state and this source is geocoded, public, and API-accessible."
        ),
        adapter_status="implemented",
        priority=10,
    ),
    COLORADO_CDOT_CRASHES_KEY: CrashSource(
        key=COLORADO_CDOT_CRASHES_KEY,
        name="Colorado DOT Statewide Crash Data Listing",
        source_url=COLORADO_CDOT_CRASHES_LANDING_URL,
        api_url=COLORADO_CDOT_CRASHES_LANDING_URL,
        geography="Colorado statewide",
        update_cadence="Annual listings with periodic corrections; 2025 is published as preliminary.",
        license_note=(
            "Official CDOT public crash listings. CDOT notes crash listings, reports, "
            "and dashboards are protected under 23 U.S.C. Section 407; preserve "
            "source attribution and use for internal safety/demand analytics."
        ),
        expected_lag="Current year preliminary; recent years remain subject to updates and revisions.",
        notes=(
            "Highest-priority next free source because Colorado is a PSG client market "
            "and CDOT publishes statewide annual crash listings instead of city-only rows."
        ),
        adapter_status="source_validated",
        priority=1,
    ),
    NYC_MOTOR_VEHICLE_COLLISIONS_KEY: CrashSource(
        key=NYC_MOTOR_VEHICLE_COLLISIONS_KEY,
        name="NYC Motor Vehicle Collisions - Crashes",
        source_url=NYC_MOTOR_VEHICLE_COLLISIONS_LANDING_URL,
        api_url=NYC_MOTOR_VEHICLE_COLLISIONS_ENDPOINT,
        geography="New York City, NY",
        update_cadence="Open Data feed updated by NYC/NYPD on an ongoing basis.",
        license_note="Public NYC Open Data feed; preserve attribution and source terms.",
        expected_lag="Operational reporting lag; suitable for annual trend analysis.",
        notes=(
            "Second-priority free adapter because it can reuse the Socrata ingestion "
            "pattern from Chicago."
        ),
        adapter_status="planned",
        priority=2,
    ),
    MISSOURI_CRASH_REFERENCES_KEY: CrashSource(
        key=MISSOURI_CRASH_REFERENCES_KEY,
        name="Missouri MoDOT/MSHP Crash Data References",
        source_url=MISSOURI_MODOT_CRASH_DASHBOARD_URL,
        api_url=MISSOURI_MSHP_CRASH_DATA_URL,
        geography="Missouri statewide / St. Louis",
        update_cadence="Dashboards and statistics are updated by MoDOT/MSHP; raw extract path still requires validation.",
        license_note="Official Missouri public crash statistics references; verify extract terms before row-level import.",
        expected_lag="Annual and dashboard lag; not treated as near-real-time incident data.",
        notes=(
            "Priority market for PSG, but not yet a clean crash-level API. Treat this "
            "as a discovery source before building around dashboards or daily PDFs."
        ),
        adapter_status="discovery_required",
        priority=3,
    ),
    CALIFORNIA_CCRS_TIMS_KEY: CrashSource(
        key=CALIFORNIA_CCRS_TIMS_KEY,
        name="California CHP CCRS / Berkeley TIMS Crash Data",
        source_url=CALIFORNIA_CCRS_URL,
        api_url=CALIFORNIA_TIMS_URL,
        geography="California statewide",
        update_cadence="Statewide crash records and query/map exports update as CHP/agency reports are processed.",
        license_note="Official California crash records reference; verify CCRS/TIMS export terms before row-level import.",
        expected_lag="Reporting and geocoding lag; suitable for annual metro and ZIP targeting trends.",
        notes=(
            "High strategic value for LA, SF, San Diego, San Jose, Sacramento, and "
            "Oakland, but likely a heavier adapter than Socrata feeds."
        ),
        adapter_status="planned",
        priority=4,
    ),
    FARS_CRASHES_KEY: CrashSource(
        key=FARS_CRASHES_KEY,
        name="NHTSA FARS - Fatality Analysis Reporting System",
        source_url=FARS_CRASHES_LANDING_URL,
        api_url=FARS_CRASHES_API_BASE,
        geography="United States",
        update_cadence=(
            "Annual final data typically released 8-12 months after the crash year; "
            "annual preliminary data released within the year following the crash year."
        ),
        license_note=(
            "Public NHTSA open data. FARS contains only fatal crashes (at least one "
            "fatality within 30 days of the crash). Preserve source attribution."
        ),
        expected_lag=(
            "Final data lags by ~8-12 months; suitable for annual and multi-year "
            "national fatal crash trend analysis."
        ),
        notes=(
            "National fatal crash coverage across all 50 states and DC. All records "
            "carry severity='fatal'. Provides PSG with nationwide baseline demand "
            "signal beyond state-specific adapters."
        ),
        adapter_status="implemented",
        priority=5,
    )
}


def get_crash_source(key: str = CHICAGO_TRAFFIC_CRASHES_KEY) -> CrashSource:
    try:
        return CRASH_SOURCES[key]
    except KeyError as error:
        raise KeyError(f"Unknown crash source: {key}") from error


def prioritized_crash_sources() -> list[CrashSource]:
    return sorted(CRASH_SOURCES.values(), key=lambda source: (source.priority, source.key))
