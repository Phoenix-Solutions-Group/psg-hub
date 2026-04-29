"""Project constants for PSG Data Lake."""

import os

from accident_sources import canonical_accident_source

PROJECT_ID = "n8n-workspace-apis"
DATASET_ID = "psg_geo_data"
ADVANTAGE_DATASET_ID = "psg_advantage_data"

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SERVICE_ACCOUNT_PATH = os.path.join(
    _BASE_DIR, "..", "bigQuery-n8n-workspace-apis-456b10536e37.json"
)

DATA_DIR = os.path.join(_BASE_DIR, "..", "GitHub", "us-maps", "reference")
GEOJSON_DIR = os.path.join(_BASE_DIR, "..", "GitHub", "State-zip-code-GeoJSON")
ACCIDENTS_CSV_PATH = os.path.join(_BASE_DIR, "..", "BodyShop", "US_Accidents_March23 copy.csv")
ACCIDENTS_SOURCE = os.getenv("ACCIDENTS_SOURCE", "huggingface")
_DEFAULT_ACCIDENTS_SOURCE = canonical_accident_source()
ACCIDENTS_HF_REPO = os.getenv("ACCIDENTS_HF_REPO", _DEFAULT_ACCIDENTS_SOURCE.hf_repo)
ACCIDENTS_HF_CONFIG = os.getenv("ACCIDENTS_HF_CONFIG", _DEFAULT_ACCIDENTS_SOURCE.hf_config)
ACCIDENTS_HF_SPLIT = os.getenv("ACCIDENTS_HF_SPLIT", _DEFAULT_ACCIDENTS_SOURCE.hf_split)
