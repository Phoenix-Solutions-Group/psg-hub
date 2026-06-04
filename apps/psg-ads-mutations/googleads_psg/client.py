"""GoogleAdsClient factory. Loads credentials from .env at apps/ads/.env."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from google.ads.googleads.client import GoogleAdsClient

_REPO_ENV = Path(__file__).resolve().parent.parent / ".env"


def load_client() -> GoogleAdsClient:
    """Load GoogleAdsClient from env vars. Reads apps/ads/.env if present."""
    if _REPO_ENV.exists():
        load_dotenv(_REPO_ENV)

    required = [
        "GOOGLE_ADS_DEVELOPER_TOKEN",
        "GOOGLE_ADS_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET",
        "GOOGLE_ADS_REFRESH_TOKEN",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    ]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise RuntimeError(
            f"Missing required env vars: {', '.join(missing)}. "
            f"Set them in apps/ads/.env (see .env.example)."
        )

    config = {
        "developer_token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
        "login_customer_id": os.environ["GOOGLE_ADS_LOGIN_CUSTOMER_ID"],
        "use_proto_plus": os.getenv("GOOGLE_ADS_USE_PROTO_PLUS", "true").lower() == "true",
    }
    return GoogleAdsClient.load_from_dict(config)
