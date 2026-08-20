#!/usr/bin/env python3
"""Import the minimal NAIC property/casualty identity registry used for matching."""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SOURCE = "naic_loc"
DEFAULT_RELEASE = date(2026, 6, 24)
DEFAULT_URL = (
    "https://content.naic.org/sites/default/files/"
    "publication-detail-list-companies-2026-jun.zip"
)
STOP_WORDS = re.compile(
    r"\b(insurance|insurer|ins|company|co|corporation|corp|group|grp|"
    r"incorporated|inc|llc|ltd)\b",
    re.IGNORECASE,
)
DISPLAY_WORDS = {
    "AMER": "America",
    "ASSUR": "Assurance",
    "CAS": "Casualty",
    "CNTY": "County",
    "CO": "Company",
    "CORP": "Corporation",
    "GEN": "General",
    "GRP": "Group",
    "IND": "Indemnity",
    "INS": "Insurance",
    "MUT": "Mutual",
    "NATL": "National",
    "PROP": "Property",
}
ACRONYMS = {"AAA", "AIG", "GEICO", "USAA", "USA"}


def load_env(path: Path) -> dict[str, str]:
    if not path.is_absolute():
        raise ValueError("--env-file must be an absolute path")
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    return values


def match_key(value: str) -> str:
    value = value.casefold().replace("&", " and ")
    value = STOP_WORDS.sub(" ", value)
    normalized = " ".join(re.findall(r"[a-z0-9]+", value))
    if re.fullmatch(r"[a-z0-9]( [a-z0-9])+", normalized):
        return normalized.replace(" ", "")
    return normalized


def display_name(value: str) -> str:
    words = re.findall(r"[A-Z0-9]+|&", value.upper())
    rendered = []
    for word in words:
        if word == "&":
            rendered.append("&")
        elif word in ACRONYMS:
            rendered.append(word)
        elif word in DISPLAY_WORDS:
            rendered.append(DISPLAY_WORDS[word])
        else:
            rendered.append(word.capitalize())
    return " ".join(rendered)


def csv_rows(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with archive.open(name) as raw, io.TextIOWrapper(
        raw, encoding="cp1252", newline=""
    ) as text:
        return list(csv.DictReader(text))


def integer(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def registry_rows(
    property_rows: list[dict[str, str]],
    group_rows: list[dict[str, str]],
    release: date,
    source_url: str,
) -> list[dict[str, Any]]:
    imported_at = datetime.now(timezone.utc).isoformat()
    companies: list[dict[str, Any]] = []
    group_codes: set[str] = set()
    active_group_codes: set[str] = set()

    for row in property_rows:
        company_code = row.get("COMPANY CODE", "").strip()
        registry_name = row.get("COMPANY NAME", "").strip()
        status = integer(row.get("COMPANY STATUS"))
        if not company_code or not registry_name or status not in {0, 1, 4, 6}:
            continue
        group_code = row.get("GROUP CODE", "").strip() or None
        if group_code:
            group_codes.add(group_code)
            if status == 1:
                active_group_codes.add(group_code)
        name = display_name(registry_name)
        companies.append(
            {
                "source": SOURCE,
                "record_type": "company",
                "registry_id": company_code,
                "registry_name": registry_name,
                "display_name": name,
                "match_key": match_key(name),
                "group_code": group_code,
                "company_code": company_code,
                "state_of_domicile": row.get("STATE OF DOMICILE", "").strip()
                or None,
                "company_status": status,
                "is_current": status == 1,
                "source_release": release.isoformat(),
                "source_url": source_url,
                "imported_at": imported_at,
            }
        )

    group_names: dict[str, str] = {}
    for row in group_rows:
        code = row.get("GROUP CODE", "").strip()
        name = row.get("GROUP NAME", "").strip()
        if code in group_codes and name:
            group_names.setdefault(code, name)

    groups = []
    for code, registry_name in group_names.items():
        name = display_name(registry_name)
        is_current = code in active_group_codes
        groups.append(
            {
                "source": SOURCE,
                "record_type": "group",
                "registry_id": code,
                "registry_name": registry_name,
                "display_name": name,
                "match_key": match_key(name),
                "group_code": code,
                "company_code": None,
                "state_of_domicile": None,
                "company_status": 1 if is_current else 6,
                "is_current": is_current,
                "source_release": release.isoformat(),
                "source_url": source_url,
                "imported_at": imported_at,
            }
        )

    return sorted(
        [*groups, *companies],
        key=lambda row: (row["record_type"], row["registry_id"]),
    )


def download(url: str) -> bytes:
    request = urllib.request.Request(
        url, headers={"User-Agent": "PSG collision insurer registry importer"}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def chunks(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def request(self, path: str, payload: Any, method: str, prefer: str) -> None:
        request = urllib.request.Request(
            f"{self.base}/{path}",
            data=json.dumps(payload, separators=(",", ":")).encode(),
            headers={**self.headers, "Prefer": prefer},
            method=method,
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=180):
                    return
            except urllib.error.HTTPError as error:
                details = error.read().decode(errors="replace")
                if error.code not in {429, 502, 503, 504} or attempt == 3:
                    raise RuntimeError(
                        f"Supabase HTTP {error.code}: {details}"
                    ) from error
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
            time.sleep(2**attempt)

    def upsert(self, rows: list[dict[str, Any]]) -> None:
        query = urllib.parse.urlencode(
            {"on_conflict": "source,record_type,registry_id"}
        )
        self.request(
            f"collision_insurer_registry?{query}",
            rows,
            "POST",
            "resolution=merge-duplicates,return=minimal",
        )

    def mark_previous_release_stale(self, release: date) -> None:
        filters = urllib.parse.urlencode(
            {
                "source": f"eq.{SOURCE}",
                "source_release": f"neq.{release.isoformat()}",
            }
        )
        self.request(
            f"collision_insurer_registry?{filters}",
            {"is_current": False},
            "PATCH",
            "return=minimal",
        )


def self_check() -> None:
    properties = [
        {
            "COMPANY NAME": "PROGRESSIVE DIRECT INS CO",
            "STATE OF DOMICILE": "OH",
            "GROUP CODE": "155",
            "COMPANY CODE": "16322",
            "COMPANY STATUS": "1",
        }
    ]
    groups = [{"GROUP NAME": "PROGRESSIVE GRP", "GROUP CODE": "155"}]
    rows = registry_rows(properties, groups, DEFAULT_RELEASE, DEFAULT_URL)
    assert len(rows) == 2
    assert rows[0]["display_name"] == "Progressive Direct Insurance Company"
    assert rows[1]["display_name"] == "Progressive Group"
    assert rows[1]["match_key"] == "progressive"
    assert match_key("U S A A INS CO") == "usaa"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--source-url", default=DEFAULT_URL)
    parser.add_argument("--release-date", type=date.fromisoformat, default=DEFAULT_RELEASE)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    if args.self_check:
        self_check()
        print("NAIC insurer registry self-check passed")
        return 0

    payload = download(args.source_url)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        rows = registry_rows(
            csv_rows(archive, "PROP.csv"),
            csv_rows(archive, "GPNM.csv"),
            args.release_date,
            args.source_url,
        )
    summary = {
        "source": SOURCE,
        "release": args.release_date.isoformat(),
        "groups": sum(row["record_type"] == "group" for row in rows),
        "companies": sum(row["record_type"] == "company" for row in rows),
        "active": sum(bool(row["is_current"]) for row in rows),
    }
    if args.dry_run:
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    if args.env_file is None:
        parser.error("--env-file is required unless --dry-run or --self-check is used")
    env = load_env(args.env_file)
    client = Supabase(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    for batch in chunks(rows, 500):
        client.upsert(batch)
    client.mark_previous_release_stale(args.release_date)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
