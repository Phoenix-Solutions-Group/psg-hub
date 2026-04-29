"""Canonical accident dataset source registry."""

from __future__ import annotations

from dataclasses import dataclass


CANONICAL_ACCIDENT_SOURCE_KEY = "updated_2016_2023"


@dataclass(frozen=True)
class AccidentSource:
    key: str
    hf_repo: str
    hf_config: str
    hf_split: str
    expected_row_count: int
    expected_column_count: int
    license: str | None
    role: str
    duplicate_of: str | None = None
    notes: str = ""


ACCIDENT_SOURCES: dict[str, AccidentSource] = {
    CANONICAL_ACCIDENT_SOURCE_KEY: AccidentSource(
        key=CANONICAL_ACCIDENT_SOURCE_KEY,
        hf_repo="yuvidhepe/us-accidents-updated",
        hf_config="default",
        hf_split="train",
        expected_row_count=7_728_394,
        expected_column_count=46,
        license="cc-by-nc-sa-4.0",
        role="canonical",
        notes=(
            "Canonical PSG accident source. Covers February 2016 through "
            "March 2023 and supersedes the older nateraw 2016-2021 corpus."
        ),
    ),
    "sanjana_2016_2023": AccidentSource(
        key="sanjana_2016_2023",
        hf_repo="Sanjana7787/us-accidents-2016-2023",
        hf_config="default",
        hf_split="train",
        expected_row_count=7_728_394,
        expected_column_count=46,
        license=None,
        role="duplicate_mirror",
        duplicate_of=CANONICAL_ACCIDENT_SOURCE_KEY,
        notes=(
            "Equivalent 7.7M-row mirror of the canonical 2016-2023 corpus. "
            "Do not merge with the canonical source."
        ),
    ),
    "legacy_2016_2021": AccidentSource(
        key="legacy_2016_2021",
        hf_repo="nateraw/us-accidents",
        hf_config="default",
        hf_split="train",
        expected_row_count=2_845_342,
        expected_column_count=47,
        license="cc-by-nc-sa-4.0",
        role="legacy_fallback",
        notes=(
            "Legacy PSG fallback source covering 2016-2021. Kept for "
            "emergency reproducibility only."
        ),
    ),
}


def canonical_accident_source() -> AccidentSource:
    return ACCIDENT_SOURCES[CANONICAL_ACCIDENT_SOURCE_KEY]


def get_accident_source(key_or_repo: str | None = None) -> AccidentSource:
    """Resolve a source by registry key or Hugging Face repo id."""
    if not key_or_repo:
        return canonical_accident_source()

    if key_or_repo in ACCIDENT_SOURCES:
        return ACCIDENT_SOURCES[key_or_repo]

    for source in ACCIDENT_SOURCES.values():
        if source.hf_repo.lower() == key_or_repo.lower():
            return source

    raise KeyError(f"Unknown accident source: {key_or_repo}")
