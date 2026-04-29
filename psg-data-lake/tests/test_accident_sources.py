"""Tests for accident source selection and duplicate classification."""

from accident_sources import (
    CANONICAL_ACCIDENT_SOURCE_KEY,
    canonical_accident_source,
    get_accident_source,
)
from config import ACCIDENTS_HF_CONFIG, ACCIDENTS_HF_REPO, ACCIDENTS_HF_SPLIT


def test_canonical_source_is_updated_huggingface_dataset():
    source = canonical_accident_source()

    assert source.key == CANONICAL_ACCIDENT_SOURCE_KEY
    assert source.hf_repo == "yuvidhepe/us-accidents-updated"
    assert source.hf_config == "default"
    assert source.hf_split == "train"
    assert source.expected_row_count == 7_728_394
    assert source.expected_column_count == 46
    assert source.license == "cc-by-nc-sa-4.0"
    assert source.role == "canonical"


def test_duplicate_and_legacy_sources_are_classified():
    mirror = get_accident_source("Sanjana7787/us-accidents-2016-2023")
    legacy = get_accident_source("nateraw/us-accidents")

    assert mirror.role == "duplicate_mirror"
    assert mirror.duplicate_of == CANONICAL_ACCIDENT_SOURCE_KEY
    assert legacy.role == "legacy_fallback"
    assert legacy.expected_row_count == 2_845_342


def test_config_defaults_to_canonical_source():
    assert ACCIDENTS_HF_REPO == "yuvidhepe/us-accidents-updated"
    assert ACCIDENTS_HF_CONFIG == "default"
    assert ACCIDENTS_HF_SPLIT == "train"
