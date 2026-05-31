"""One-shot helper to obtain a Google Ads refresh token.

Run this once after you have CLIENT_ID + CLIENT_SECRET in your .env. It will:
  1. Open a browser for you to grant consent
  2. Receive the OAuth2 code via localhost redirect
  3. Exchange it for a refresh token
  4. Print the refresh token for you to paste into .env

Usage:
    python -m googleads_psg.auth_bootstrap

Prereqs:
  - GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET set in apps/ads/.env
  - OAuth client in Google Cloud Console must include http://localhost:8080/
    in its Authorized redirect URIs.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

_SCOPE = "https://www.googleapis.com/auth/adwords"
_REDIRECT_URI = "http://localhost:8080/"

_REPO_ENV = Path(__file__).resolve().parent.parent / ".env"


def main() -> int:
    if _REPO_ENV.exists():
        load_dotenv(_REPO_ENV)

    client_id = os.getenv("GOOGLE_ADS_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_ADS_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("Error: GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET required in .env")
        return 1

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("Missing dependency. Install with: pip install google-auth-oauthlib")
        return 1

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
        scopes=[_SCOPE],
    )

    creds = flow.run_local_server(port=8080, prompt="consent")
    print("\n" + "=" * 60)
    print("SUCCESS. Paste this refresh token into apps/ads/.env:")
    print("=" * 60)
    print(f"GOOGLE_ADS_REFRESH_TOKEN={creds.refresh_token}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
