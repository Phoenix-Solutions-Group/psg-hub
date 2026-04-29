"""Storm-event source registry for PSG demand signals."""

from __future__ import annotations

from dataclasses import dataclass, field


CANONICAL_STORM_SOURCE_KEY = "ncei_storm_events"

NCEI_STORM_EVENTS_BASE_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
NCEI_STORM_EVENTS_LANDING_URL = "https://www.ncei.noaa.gov/stormevents/ftp.jsp"
NCEI_STORM_EVENTS_FORMAT_URL = (
    "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
    "Storm-Data-Bulk-csv-Format.pdf"
)
SPC_SEVERE_WEATHER_GIS_URL = "https://origin-west-www-spc.woc.noaa.gov/gis/svrgis/"


@dataclass(frozen=True)
class StormSource:
    key: str
    name: str
    source_url: str
    bulk_csv_base_url: str
    documentation_url: str
    supplemental_geo_url: str | None
    update_cadence: str
    license_note: str
    csv_file_families: tuple[str, ...] = field(default_factory=tuple)
    supported_start_year: int = 1950
    supported_end_year: int | None = None
    notes: str = ""

    def details_file_pattern(self, year: int, cycle: str = "YYYYMMDD") -> str:
        return f"StormEvents_details-ftp_v1.0_d{year}_c{cycle}.csv.gz"


STORM_SOURCES: dict[str, StormSource] = {
    CANONICAL_STORM_SOURCE_KEY: StormSource(
        key=CANONICAL_STORM_SOURCE_KEY,
        name="NOAA NCEI Storm Events bulk CSV",
        source_url=NCEI_STORM_EVENTS_LANDING_URL,
        bulk_csv_base_url=NCEI_STORM_EVENTS_BASE_URL,
        documentation_url=NCEI_STORM_EVENTS_FORMAT_URL,
        supplemental_geo_url=SPC_SEVERE_WEATHER_GIS_URL,
        update_cadence="Monthly/as NOAA publishes updated bulk CSV cycles",
        license_note=(
            "NOAA/NCEI public U.S. government data. Preserve source attribution "
            "and check NOAA terms before redistribution."
        ),
        csv_file_families=("details", "fatalities", "locations"),
        supported_start_year=1950,
        supported_end_year=2026,
        notes=(
            "Canonical PSG storm-event truth source. V1 loads details files and "
            "keeps SPC severe-weather GIS as a supplemental hail/wind/tornado "
            "geometry reference, not the source of record."
        ),
    )
}


def canonical_storm_source() -> StormSource:
    return STORM_SOURCES[CANONICAL_STORM_SOURCE_KEY]


def get_storm_source(key: str | None = None) -> StormSource:
    if not key:
        return canonical_storm_source()
    try:
        return STORM_SOURCES[key]
    except KeyError as error:
        raise KeyError(f"Unknown storm source: {key}") from error
