"""One-shot helper to obtain a GTM API refresh token.

Run this once after CLIENT_ID + CLIENT_SECRET are in apps/ads/.env:

    python -m gtm_psg.auth_bootstrap

Opens a browser for OAuth consent, captures the code on localhost, exchanges
for a refresh token with GTM edit + publish scopes, and prints the value to
paste into .env as `GTM_REFRESH_TOKEN`.

The OAuth client in Google Cloud Console must:
  - Have http://localhost:8090/ in Authorized redirect URIs
  - Have Tag Manager API enabled on the project
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from gtm_psg.client import SCOPES

_REDIRECT_URI = "http://localhost:8090/"
_REPO_ENV = Path(__file__).resolve().parent.parent / ".env"


def main() -> int:
    if _REPO_ENV.exists():
        load_dotenv(_REPO_ENV)

    client_id = os.getenv("GOOGLE_ADS_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_ADS_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("Error: GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET required in .env")
        return 1

    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_config(
        {
            "installed": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [_REDIRECT_URI],
            }
        },
        scopes=SCOPES,
    )

    creds = flow.run_local_server(port=8090, prompt="consent")
    print("\n" + "=" * 60)
    print("SUCCESS. Paste this refresh token into apps/ads/.env:")
    print("=" * 60)
    print(f"GTM_REFRESH_TOKEN={creds.refresh_token}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
