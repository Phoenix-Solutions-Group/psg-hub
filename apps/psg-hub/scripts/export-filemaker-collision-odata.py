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
import xml.etree.ElementTree as ET
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
DEFAULT_TABLE = '"Master_Repair Customer"'
DEFAULT_START_DATE = "2020-01-01"
DEFAULT_REQUEST_TIMEOUT_SECONDS = 900


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
    database = database.strip()
    if not database:
        raise ValueError("FILEMAKER_ODATA_DATABASE cannot be empty")
    if not database.lower().endswith(".fmp12"):
        database = f"{database}.fmp12"
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
    return f"{root}/{urllib.parse.quote(table, safe='')}?{query}"


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
    detail = ""
    try:
        error = json.loads(body).get("error", {})
        detail = ": ".join(
            str(error[key]) for key in ("code", "message") if error.get(key)
        )
    except (AttributeError, json.JSONDecodeError, UnicodeDecodeError):
        try:
            root = ET.fromstring(body)
            values = {
                node.tag.rsplit("}", 1)[-1]: (node.text or "").strip()
                for node in root.iter()
            }
            detail = ": ".join(
                values[key] for key in ("code", "message") if values.get(key)
            )
        except (ET.ParseError, UnicodeDecodeError):
            pass
    return f"FileMaker OData HTTP {status}" + (f" ({detail})" if detail else "")


def odata_control(payload: dict[str, Any], name: str) -> Any:
    for key in (f"@{name}", f"@odata.{name}"):
        if key in payload:
            return payload[key]
    raise RuntimeError(f"FileMaker OData response omitted its {name} annotation")


def http_fetcher(
    account: str, password: str, timeout_seconds: int
) -> Callable[[str], dict[str, Any]]:
    if not 30 <= timeout_seconds <= 1800:
        raise ValueError("request timeout must be between 30 and 1800 seconds")
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
                with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                    return json.loads(response.read(), parse_float=Decimal)
            except urllib.error.HTTPError as error:
                if error.code not in {429, 502, 503, 504} or attempt == 3:
                    raise RuntimeError(
                        http_error_message(error.code, error.read(4096))
                    ) from error
                time.sleep(2**attempt)
            except TimeoutError:
                raise
            except urllib.error.URLError as error:
                if isinstance(error.reason, TimeoutError):
                    raise
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
                    expected = int(odata_control(payload, "count"))
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
                next_link = payload.get("@nextLink", payload.get("@odata.nextLink"))
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


def probe_source(
    start_url: str,
    fetch: Callable[[str], dict[str, Any]],
    minimum_rows: int,
    maximum_rows: int,
) -> dict[str, Any]:
    top = urllib.parse.urlencode({"$top": "1"}, quote_via=urllib.parse.quote)
    payload = fetch(f"{start_url}&{top}")
    expected = int(odata_control(payload, "count"))
    if not minimum_rows <= expected <= maximum_rows:
        raise RuntimeError(
            f"FileMaker scope count {expected} is outside the approved "
            f"range {minimum_rows}-{maximum_rows}"
        )
    rows = payload.get("value")
    if not isinstance(rows, list) or len(rows) != 1:
        raise RuntimeError("FileMaker OData probe did not return exactly one record")
    returned = {key for key in rows[0] if key != "ROWID" and not key.startswith("@")}
    if returned != set(FIELDS):
        missing = sorted(set(FIELDS) - returned)
        extra = sorted(returned - set(FIELDS))
        raise RuntimeError(
            f"FileMaker OData probe field mismatch; missing={missing}, extra={extra}"
        )
    return {
        "status": "ready",
        "rows": expected,
        "fields": len(returned),
        "pii_fields": 0,
    }


def self_test() -> dict[str, Any]:
    root = service_root("https://filemaker.example.com", "Advantage")
    start = initial_url(root, DEFAULT_TABLE, DEFAULT_START_DATE)
    page_two = f"{root}/{DEFAULT_TABLE}?page=2"
    sample = {field: f"value-{field}" for field in FIELDS}
    pages = {
        start: {"@odata.count": 2, "value": [sample], "@nextLink": page_two},
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
    assert root.endswith("/Advantage.fmp12")
    assert "/%22Master_Repair%20Customer%22?" in start
    try:
        safe_page_url(root, start, "https://attacker.example/records")
    except ValueError:
        pass
    else:
        raise AssertionError("off-host pagination URL was accepted")
    assert http_error_message(
        400, b'{"error":{"code":"8309","message":"Invalid query"}}'
    ) == "FileMaker OData HTTP 400 (8309: Invalid query)"
    assert http_error_message(
        501,
        b'<m:error xmlns:m="urn:test"><m:code>802</m:code><m:message>Unable to open file</m:message></m:error>',
    ) == "FileMaker OData HTTP 501 (802: Unable to open file)"
    assert odata_control({"@count": "2"}, "count") == "2"
    assert odata_control({"@odata.count": 2}, "count") == 2
    assert probe_source(
        start,
        lambda _: {
            "@count": 2,
            "value": [{"@etag": "opaque", "ROWID": "1", **sample}],
        },
        2,
        2,
    ) == {"status": "ready", "rows": 2, "fields": len(FIELDS), "pii_fields": 0}
    try:
        http_fetcher("account", "password", 29)
    except ValueError:
        pass
    else:
        raise AssertionError("unsafe request timeout was accepted")
    return {"self_test": "passed", "fields": len(FIELDS), "pii_fields": 0}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    if not args.env_file or (not args.probe and not args.output_file):
        raise ValueError(
            "--env-file and either --probe or --output-file are required unless --self-test is used"
        )
    env = load_env(Path(args.env_file))
    root = service_root(env["FILEMAKER_ODATA_BASE_URL"], env["FILEMAKER_ODATA_DATABASE"])
    start_url = initial_url(root, args.table, args.start_date)
    fetch = http_fetcher(
        env["FILEMAKER_ODATA_ACCOUNT"],
        env["FILEMAKER_ODATA_PASSWORD"],
        args.request_timeout_seconds,
    )
    if args.probe:
        return probe_source(start_url, fetch, args.minimum_rows, args.maximum_rows)
    return export_snapshot(
        Path(args.output_file),
        root,
        start_url,
        fetch,
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
    parser.add_argument(
        "--request-timeout-seconds",
        type=int,
        default=DEFAULT_REQUEST_TIMEOUT_SECONDS,
    )
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
