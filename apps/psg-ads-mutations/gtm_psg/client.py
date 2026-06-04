"""Google Tag Manager API v2 client factory.

Loads OAuth credentials from apps/ads/.env. Reuses the same OAuth client
(CLIENT_ID + CLIENT_SECRET) as Google Ads but with a GTM-specific refresh
token (GTM_REFRESH_TOKEN), since the GTM scopes differ from `auth/adwords`.

Required env vars:
  GOOGLE_ADS_CLIENT_ID
  GOOGLE_ADS_CLIENT_SECRET
  GTM_REFRESH_TOKEN          -- obtain via `python -m gtm_psg.auth_bootstrap`
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import Resource, build

_REPO_ENV = Path(__file__).resolve().parent.parent / ".env"

SCOPES = [
    "https://www.googleapis.com/auth/tagmanager.edit.containers",
    "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
    "https://www.googleapis.com/auth/tagmanager.publish",
    "https://www.googleapis.com/auth/tagmanager.readonly",
]


def load_credentials() -> Credentials:
    if _REPO_ENV.exists():
        load_dotenv(_REPO_ENV)

    required = ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GTM_REFRESH_TOKEN"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        raise RuntimeError(
            f"Missing required env vars: {', '.join(missing)}. "
            f"Run `python -m gtm_psg.auth_bootstrap` after setting "
            f"GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET."
        )

    creds = Credentials(
        token=None,
        refresh_token=os.environ["GTM_REFRESH_TOKEN"],
        client_id=os.environ["GOOGLE_ADS_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return creds


def load_gtm_service() -> Resource:
    """Return an authenticated Tag Manager API v2 service object."""
    creds = load_credentials()
    return build("tagmanager", "v2", credentials=creds, cache_discovery=False)
