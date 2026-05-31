import os
from google.ads.googleads.client import GoogleAdsClient

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "google-ads.yaml")


def get_client(config_path: str = None) -> GoogleAdsClient:
    path = config_path or os.environ.get("GOOGLE_ADS_CONFIG", _CONFIG_PATH)
    return GoogleAdsClient.load_from_storage(path, version="v20")
