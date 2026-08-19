#!/usr/bin/env python3
"""Export the governed FileMaker collision snapshot through read-only OData."""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable


FIELDS = (
    "RC_CreationDate",
    "RC_MatchField_Master",
    "RC_Shop",
    "RC_PayType",
    "RC_SerialNum",
    "RC_InsuranceCompany",
    "RC_Date_In",
    "RC_Date_Out",
    "RC_Repair_Dlz",
    "RC_Vehicle_Yr",
    "RC_Vehicle_Make",
    "RC_Vehicle_Model",
    "RC_RONumber",
    "RC_Cust_State",
    "RC_Cust_Zip",
)
DEFAULT_TABLE = "FMTID:131"
DEFAULT_START_DATE = "2020-01-01"


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


def service_root(base_url: str, database: str) -> str:
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("FILEMAKER_ODATA_BASE_URL must be an HTTPS origin without credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("FILEMAKER_ODATA_BASE_URL cannot include a query or fragment")
    origin = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "")
    )
    return f"{origin}/fmi/odata/v4/{urllib.parse.quote(database, safe='')}"


def initial_url(root: str, table: str, start_date: str) -> str:
    date.fromisoformat(start_date)
    query = urllib.parse.urlencode(
        {
            "$select": ",".join(("ROWID", *(f'\"{field}\"' for field in FIELDS))),
            "$filter": f'\"RC_CreationDate\" ge {start_date}',
            "$orderby": "ROWID asc",
            "$count": "true",
        },
        quote_via=urllib.parse.quote,
    )
    return f"{root}/{urllib.parse.quote(table, safe=':')}?{query}"


def safe_page_url(root: str, current_url: str, candidate: str) -> str:
    resolved = urllib.parse.urljoin(current_url, candidate)
    root_parts = urllib.parse.urlsplit(root)
    parts = urllib.parse.urlsplit(resolved)
    if parts.scheme != "https" or parts.netloc != root_parts.netloc:
        raise ValueError("FileMaker pagination attempted to leave the configured HTTPS host")
    if not parts.path.startswith(root_parts.path.rstrip("/") + "/"):
        raise ValueError("FileMaker pagination attempted to leave the configured OData service")
    return resolved


def http_error_message(status: int, body: bytes) -> str:
    try:
        error = json.loads(body).get("error", {})
        detail = ": ".join(
            str(error[key]) for key in ("code", "message") if error.get(key)
        )
    except (AttributeError, json.JSONDecodeError, UnicodeDecodeError):
        detail = ""
    return f"FileMaker OData HTTP {status}" + (f" ({detail})" if detail else "")


def http_fetcher(account: str, password: str) -> Callable[[str], dict[str, Any]]:
    authorization = base64.b64encode(f"{account}:{password}".encode()).decode()

    def fetch(url: str) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Basic {authorization}",
                "Accept": "application/json;IEEE754Compatible=true",
                "User-Agent": "PSG collision intelligence FileMaker refresh",
            },
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    return json.loads(response.read(), parse_float=Decimal)
            except urllib.error.HTTPError as error:
                if error.code not in {429, 502, 503, 504} or attempt == 3:
                    raise RuntimeError(
                        http_error_message(error.code, error.read(4096))
                    ) from error
                time.sleep(2**attempt)
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2**attempt)
        raise AssertionError("unreachable")

    return fetch


def export_snapshot(
    output: Path,
    root: str,
    start_url: str,
    fetch: Callable[[str], dict[str, Any]],
    minimum_rows: int,
    maximum_rows: int,
) -> dict[str, Any]:
    if not output.is_absolute() or not output.parent.is_dir():
        raise ValueError("--output-file must be an absolute path in an existing directory")
    if minimum_rows < 1 or maximum_rows < minimum_rows:
        raise ValueError("row bounds must be positive and maximum must be at least minimum")

    temporary: Path | None = None
    expected: int | None = None
    received = pages = 0
    url: str | None = start_url
    previous_url = start_url
    seen_urls: set[str] = set()
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            writer = csv.DictWriter(handle, fieldnames=FIELDS, extrasaction="ignore")
            writer.writeheader()
            while url:
                url = safe_page_url(root, previous_url, url)
                if url in seen_urls:
                    raise RuntimeError("FileMaker OData pagination repeated a page URL")
                seen_urls.add(url)
                payload = fetch(url)
                pages += 1
                if expected is None:
                    if "@odata.count" not in payload:
                        raise RuntimeError("FileMaker OData response omitted @odata.count")
                    expected = int(payload["@odata.count"])
                    if not minimum_rows <= expected <= maximum_rows:
                        raise RuntimeError(
                            f"FileMaker scope count {expected} is outside the approved "
                            f"range {minimum_rows}-{maximum_rows}"
                        )
                rows = payload.get("value")
                if not isinstance(rows, list):
                    raise RuntimeError("FileMaker OData response omitted its record list")
                for row in rows:
                    missing = [field for field in FIELDS if field not in row]
                    if missing:
                        raise RuntimeError(
                            f"FileMaker OData row omitted fields: {', '.join(missing)}"
                        )
                    writer.writerow({field: row[field] for field in FIELDS})
                    received += 1
                previous_url = url
                next_link = payload.get("@odata.nextLink")
                url = str(next_link) if next_link else None

        if expected is None or received != expected:
            raise RuntimeError(
                f"FileMaker OData count mismatch: expected {expected}, received {received}"
            )
        os.replace(temporary, output)
        temporary = None
        return {
            "status": "exported",
            "rows": received,
            "pages": pages,
            "fields": len(FIELDS),
            "pii_fields": 0,
            "output": str(output),
        }
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def self_test() -> dict[str, Any]:
    root = "https://filemaker.example.com/fmi/odata/v4/Advantage"
    start = initial_url(root, DEFAULT_TABLE, DEFAULT_START_DATE)
    page_two = f"{root}/{DEFAULT_TABLE}?page=2"
    sample = {field: f"value-{field}" for field in FIELDS}
    pages = {
        start: {"@odata.count": 2, "value": [sample], "@odata.nextLink": page_two},
        page_two: {"value": [sample]},
    }
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "repair.csv"
        result = export_snapshot(output, root, start, pages.__getitem__, 2, 2)
        with output.open(encoding="utf-8", newline="") as handle:
            rows = list(csv.DictReader(handle))
        assert result["rows"] == 2 and len(rows) == 2
        assert tuple(rows[0]) == FIELDS
        assert output.stat().st_mode & 0o077 == 0
    assert all(
        term not in FIELDS
        for term in (
            "RC_Cust_First",
            "RC_Cust_Address1",
            "RC_EmailAddress",
            "RC_Phone1",
            "RC_Birthdate",
            "RC_ClaimNum",
        )
    )
    try:
        safe_page_url(root, start, "https://attacker.example/records")
    except ValueError:
        pass
    else:
        raise AssertionError("off-host pagination URL was accepted")
    assert http_error_message(
        400, b'{"error":{"code":"8309","message":"Invalid query"}}'
    ) == "FileMaker OData HTTP 400 (8309: Invalid query)"
    return {"self_test": "passed", "fields": len(FIELDS), "pii_fields": 0}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    if not args.output_file or not args.env_file:
        raise ValueError("--output-file and --env-file are required unless --self-test is used")
    env = load_env(Path(args.env_file))
    root = service_root(env["FILEMAKER_ODATA_BASE_URL"], env["FILEMAKER_ODATA_DATABASE"])
    return export_snapshot(
        Path(args.output_file),
        root,
        initial_url(root, args.table, args.start_date),
        http_fetcher(
            env["FILEMAKER_ODATA_ACCOUNT"], env["FILEMAKER_ODATA_PASSWORD"]
        ),
        args.minimum_rows,
        args.maximum_rows,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-file")
    parser.add_argument("--env-file")
    parser.add_argument("--table", default=DEFAULT_TABLE)
    parser.add_argument("--start-date", default=DEFAULT_START_DATE)
    parser.add_argument("--minimum-rows", type=int, default=300_000)
    parser.add_argument("--maximum-rows", type=int, default=500_000)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
