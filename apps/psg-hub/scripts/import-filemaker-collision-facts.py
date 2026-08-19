#!/usr/bin/env python3
"""Import a complete FileMaker repair snapshot without customer or agent PII."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable


SOURCE_SYSTEM = "filemaker_repair_customer"
MIN_DATE = date(2010, 1, 1)
REQUIRED_COLUMNS = {
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
}
STATE_CODES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "puerto rico": "PR", "guam": "GU", "virgin islands": "VI",
}
PAYMENT_CATEGORIES = {
    "customer insurance": ("insurance", True),
    "claimant other insurance": ("insurance", True),
    "ins pay which party unknown": ("insurance", True),
    "insurance pay which party unknown": ("insurance", True),
    "claiment": ("insurance", True),
    "claimat": ("insurance", True),
    "customer pay": ("customer", False),
    "cash customer pay": ("customer", False),
    "third party pay": ("third_party", False),
    "non insurance": ("non_insurance", False),
    "fleet": ("fleet", False),
    "warranty": ("warranty", False),
    "total loss": ("other", None),
    "tloss": ("other", None),
}


class RejectedRow(ValueError):
    pass


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


def clean_text(value: Any, limit: int = 200) -> str | None:
    result = str(value).strip() if value is not None else ""
    return result[:limit] or None


def normalized_words(value: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(value or "").casefold()))


def source_record_hash(shop_key: str, serial: str, repair_order: str) -> str:
    identity = "\x1f".join([SOURCE_SYSTEM, shop_key, serial, repair_order])
    return hashlib.sha256(identity.encode()).hexdigest()


def parse_source_date(value: Any, maximum: date, issue: str) -> tuple[str | None, str | None]:
    raw = clean_text(value)
    if not raw:
        return None, None
    parsed = None
    for pattern in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%b %d, %Y"):
        try:
            parsed = datetime.strptime(raw, pattern).date()
            break
        except ValueError:
            pass
    if parsed is None or not MIN_DATE <= parsed <= maximum:
        return None, issue
    return parsed.isoformat(), None


def parse_amount_cents(value: Any) -> int:
    raw = str(value or "").strip().replace("$", "").replace(",", "").replace(" ", "")
    try:
        amount = Decimal(raw)
    except InvalidOperation as error:
        raise RejectedRow("invalid_repair_amount") from error
    if not amount.is_finite() or amount < 0:
        raise RejectedRow("invalid_repair_amount")
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def payment(value: Any) -> tuple[str | None, str, bool | None]:
    raw = clean_text(value)
    category, insured = PAYMENT_CATEGORIES.get(normalized_words(raw), ("unknown", None))
    return raw, category, insured


def customer_zip(value: Any) -> tuple[str | None, str | None]:
    raw = clean_text(value)
    if not raw:
        return None, "missing_customer_zip"
    match = re.fullmatch(r"([0-9]{5})(?:-?([0-9]{4}))?", raw)
    return (match.group(1), None) if match else (None, "invalid_customer_zip")


def customer_state(value: Any) -> tuple[str | None, str | None]:
    raw = clean_text(value)
    if not raw:
        return None, None
    upper = raw.upper()
    if re.fullmatch(r"[A-Z]{2}", upper):
        return upper, None
    code = STATE_CODES.get(normalized_words(raw))
    return (code, None) if code else (None, "invalid_customer_state")


def vehicle_year(value: Any, export_year: int) -> tuple[int | None, str | None]:
    raw = clean_text(value)
    if not raw:
        return None, None
    if re.fullmatch(r"[0-9]{4}", raw):
        year = int(raw)
        if 1900 <= year <= export_year + 2:
            return year, None
    return None, "invalid_vehicle_year"


def transform(row: dict[str, Any], source_export_id: str, maximum_date: date) -> dict[str, Any]:
    shop_key = normalized_words(row.get("RC_MatchField_Master")).upper().replace(" ", "")
    serial = clean_text(row.get("RC_SerialNum"), 500)
    repair_order = clean_text(row.get("RC_RONumber"), 500) or ""
    if not shop_key:
        raise RejectedRow("missing_shop_key")
    if not serial:
        raise RejectedRow("missing_serial")

    issues: list[str] = []
    shop_name = clean_text(row.get("RC_Shop"))
    if not shop_name:
        shop_name = shop_key
        issues.append("missing_shop_name")
    if not repair_order:
        issues.append("missing_ro_number")

    created, issue = parse_source_date(row.get("RC_CreationDate"), maximum_date, "invalid_creation_date")
    if issue:
        issues.append(issue)
    arrival, issue = parse_source_date(row.get("RC_Date_In"), maximum_date, "invalid_arrival_date")
    if issue:
        issues.append(issue)
    if not clean_text(row.get("RC_Date_In")):
        issues.append("missing_arrival_date")
    completion, issue = parse_source_date(row.get("RC_Date_Out"), maximum_date, "invalid_completion_date")
    if issue:
        issues.append(issue)
    if arrival and completion and completion < arrival:
        completion = None
        issues.append("completion_before_arrival")

    amount_cents = parse_amount_cents(row.get("RC_Repair_Dlz"))
    if amount_cents == 0:
        issues.append("zero_repair_amount")
    pay_raw, category, insured = payment(row.get("RC_PayType"))
    if category == "unknown":
        issues.append("unknown_payment_category")
    insurer_raw = clean_text(row.get("RC_InsuranceCompany"))
    insurer_normalized = normalized_words(insurer_raw) or None
    if insured is True and not insurer_raw:
        issues.append("missing_insurer_for_insured_repair")
    if insured is False and insurer_raw:
        issues.append("insurer_on_non_insured_repair")

    zip_code, issue = customer_zip(row.get("RC_Cust_Zip"))
    if issue:
        issues.append(issue)
    state_code, issue = customer_state(row.get("RC_Cust_State"))
    if issue:
        issues.append(issue)
    year, issue = vehicle_year(row.get("RC_Vehicle_Yr"), maximum_date.year)
    if issue:
        issues.append(issue)

    return {
        "source_system": SOURCE_SYSTEM,
        "source_record_hash": source_record_hash(shop_key, serial, repair_order),
        "source_export_id": source_export_id,
        "source_shop_key": shop_key,
        "source_shop_name": shop_name,
        "source_creation_date": created,
        "arrival_date": arrival,
        "completion_date": completion,
        "repair_amount_cents": amount_cents,
        "pay_type_raw": pay_raw,
        "payment_category": category,
        "is_insured": insured,
        "insurance_company_raw": insurer_raw,
        "insurance_company_normalized": insurer_normalized,
        "customer_zip": zip_code,
        "customer_state": state_code,
        "vehicle_year": year,
        "vehicle_make": clean_text(row.get("RC_Vehicle_Make"), 120),
        "vehicle_model": clean_text(row.get("RC_Vehicle_Model"), 120),
        "quality_issues": sorted(set(issues)),
    }


def csv_rows(path: Path) -> Iterable[dict[str, Any]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV is missing required columns: {', '.join(sorted(missing))}")
        yield from reader


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def profile_file(path: Path, source_export_id: str, maximum_date: date) -> dict[str, Any]:
    row_count = accepted_count = 0
    rejected = Counter()
    shop_names: dict[str, Counter[str]] = defaultdict(Counter)
    arrivals: list[str] = []
    seen = set()
    for row in csv_rows(path):
        row_count += 1
        try:
            fact = transform(row, source_export_id, maximum_date)
            record_hash = fact["source_record_hash"]
            if record_hash in seen:
                raise RejectedRow("duplicate_source_record")
            seen.add(record_hash)
            accepted_count += 1
            shop_names[fact["source_shop_key"]][fact["source_shop_name"]] += 1
            if fact["arrival_date"]:
                arrivals.append(fact["arrival_date"])
        except RejectedRow as error:
            rejected[str(error)] += 1
    return {
        "row_count": row_count,
        "accepted_count": accepted_count,
        "rejected_count": row_count - accepted_count,
        "rejected_reasons": dict(sorted(rejected.items())),
        "arrival_min": min(arrivals) if arrivals else None,
        "arrival_max": max(arrivals) if arrivals else None,
        "shop_names": {key: names.most_common(1)[0][0] for key, names in shop_names.items()},
    }


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def request(
        self,
        path: str,
        payload: Any | None = None,
        method: str = "POST",
        prefer: str | None = "resolution=merge-duplicates,return=minimal",
    ) -> Any:
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(
            f"{self.base}/{path}",
            data=json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None,
            headers=headers,
            method=method,
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    body = response.read()
                return json.loads(body) if body else None
            except urllib.error.HTTPError as error:
                details = error.read().decode(errors="replace")
                if error.code not in {429, 502, 503, 504} or attempt == 3:
                    raise RuntimeError(f"Supabase HTTP {error.code}: {details}") from error
                time.sleep(2**attempt)
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
                time.sleep(2**attempt)
        raise AssertionError("unreachable")

    def upsert(self, table: str, rows: Any, conflict: str, ignore: bool = False) -> None:
        query = urllib.parse.urlencode({"on_conflict": conflict})
        resolution = "ignore" if ignore else "merge"
        self.request(
            f"{table}?{query}",
            rows,
            prefer=f"resolution={resolution}-duplicates,return=minimal",
        )

    def source_status(self, source_export_id: str) -> str | None:
        query = urllib.parse.urlencode(
            {"select": "status", "source_export_id": f"eq.{source_export_id}"}
        )
        rows = self.request(f"collision_repair_sources?{query}", method="GET", prefer=None)
        return rows[0]["status"] if rows else None

    def update_source(self, source_export_id: str, values: dict[str, Any]) -> None:
        query = urllib.parse.urlencode({"source_export_id": f"eq.{source_export_id}"})
        self.request(
            f"collision_repair_sources?{query}",
            values,
            method="PATCH",
            prefer="return=minimal",
        )


def upload_facts(
    client: Supabase,
    path: Path,
    source_export_id: str,
    maximum_date: date,
    expected: int,
    batch_size: int,
    workers: int,
) -> int:
    completed = submitted = 0
    next_progress = 25_000
    batch: list[dict[str, Any]] = []
    seen = set()
    pending: dict[Any, int] = {}

    def collect(done: Iterable[Any]) -> None:
        nonlocal completed, next_progress
        for future in done:
            future.result()
            completed += pending.pop(future)
        if completed >= next_progress:
            print(json.dumps({"uploaded": completed, "expected": expected}), flush=True)
            next_progress = ((completed // 25_000) + 1) * 25_000

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for row in csv_rows(path):
            try:
                fact = transform(row, source_export_id, maximum_date)
            except RejectedRow:
                continue
            record_hash = fact["source_record_hash"]
            if record_hash in seen:
                continue
            seen.add(record_hash)
            batch.append(fact)
            if len(batch) < batch_size:
                continue
            future = pool.submit(
                client.upsert,
                "collision_repair_facts",
                batch,
                "source_export_id,source_record_hash",
            )
            pending[future] = len(batch)
            submitted += len(batch)
            batch = []
            if len(pending) >= workers * 2:
                done, _ = wait(pending, return_when=FIRST_COMPLETED)
                collect(done)
        if batch:
            future = pool.submit(
                client.upsert,
                "collision_repair_facts",
                batch,
                "source_export_id,source_record_hash",
            )
            pending[future] = len(batch)
            submitted += len(batch)
        while pending:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            collect(done)

    if submitted != expected or completed != expected:
        raise RuntimeError(
            f"Transformed fact count changed between passes: expected {expected}, uploaded {completed}"
        )
    return completed


def self_test() -> dict[str, Any]:
    sample = {
        "RC_CreationDate": "07/13/2026",
        "RC_MatchField_Master": "ps177",
        "RC_Shop": "Shelton Collision Repair",
        "RC_PayType": "Claimant (Other Insurance)",
        "RC_SerialNum": "SER-123",
        "RC_InsuranceCompany": "State Farm",
        "RC_Date_In": "07/01/2026",
        "RC_Date_Out": "07/08/2026",
        "RC_Repair_Dlz": "$2,227.51 ",
        "RC_Vehicle_Yr": "2023",
        "RC_Vehicle_Make": "Ford",
        "RC_Vehicle_Model": "F-150",
        "RC_RONumber": "RO-9",
        "RC_Cust_State": "Illinois",
        "RC_Cust_Zip": "60018-1234",
        "RC_Cust_First": "Alice",
        "RC_Cust_Address1": "123 Main St",
        "RC_EmailAddress": "alice@example.com",
        "RC_Phone1": "555-0100",
    }
    fact = transform(sample, "filemaker_rc_test", date(2026, 7, 14))
    assert fact["source_shop_key"] == "PS177"
    assert fact["payment_category"] == "insurance" and fact["is_insured"] is True
    assert fact["repair_amount_cents"] == 222751
    assert fact["customer_state"] == "IL" and fact["customer_zip"] == "60018"
    assert fact["source_record_hash"] == source_record_hash("PS177", "SER-123", "RO-9")
    serialized = json.dumps(fact)
    assert all(value not in serialized for value in ("Alice", "123 Main St", "alice@example.com", "555-0100", "SER-123", "RO-9"))
    assert payment("USAA")[1:] == ("unknown", None)
    assert parse_source_date("3.9.0250", date(2026, 7, 14), "bad") == (None, "bad")
    validate_source_freshness(
        datetime(2026, 7, 14, 11, tzinfo=timezone.utc),
        2,
        datetime(2026, 7, 14, 12, tzinfo=timezone.utc),
    )
    try:
        validate_source_freshness(
            datetime(2026, 7, 14, 9, tzinfo=timezone.utc),
            2,
            datetime(2026, 7, 14, 12, tzinfo=timezone.utc),
        )
    except ValueError as error:
        assert "older than" in str(error)
    else:
        raise AssertionError("stale source was accepted")
    return {"self_test": "passed", "fields": len(fact), "pii_fields": 0}


def validate_source_freshness(
    modified_at: datetime,
    maximum_age_hours: float | None,
    now: datetime | None = None,
) -> None:
    if maximum_age_hours is None:
        return
    if maximum_age_hours <= 0:
        raise ValueError("--max-file-age-hours must be positive")
    age_hours = ((now or datetime.now(timezone.utc)) - modified_at).total_seconds() / 3600
    if age_hours < -1:
        raise ValueError("input file modification time is more than one hour in the future")
    if age_hours > maximum_age_hours:
        raise ValueError(
            f"input file is {age_hours:.1f} hours old, older than the "
            f"{maximum_age_hours:g}-hour limit"
        )


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    if not args.input_file or not args.env_file:
        raise ValueError("--input-file and --env-file are required unless --self-test is used")
    if args.batch_size < 1 or args.workers < 1:
        raise ValueError("--batch-size and --workers must be positive")

    path = Path(args.input_file)
    if not path.is_absolute() or not path.is_file():
        raise ValueError("--input-file must be an absolute path to a file")
    file_modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    validate_source_freshness(file_modified, args.max_file_age_hours)
    env = load_env(Path(args.env_file))
    supabase_url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    service_key = env["SUPABASE_SERVICE_ROLE_KEY"]
    if args.project_id not in supabase_url:
        raise ValueError("Supabase URL does not match --project-id")

    file_hash = sha256_file(path)
    source_export_id = f"filemaker_rc_{file_hash[:20]}"
    maximum_date = file_modified.date() + timedelta(days=1)
    profile = profile_file(path, source_export_id, maximum_date)
    client = Supabase(supabase_url, service_key)
    existing_status = client.source_status(source_export_id)
    if existing_status in {"loaded", "superseded"}:
        return {
            "source_export_id": source_export_id,
            "status": existing_status,
            "skipped": "identical_file_already_reconciled",
        }

    notes = (
        "PII-minimized FileMaker snapshot; customer/agent names, street addresses, email, "
        "phones, birthdates, raw repair-order numbers, raw serials, and raw payload are excluded. "
        f"Rejected reasons: {json.dumps(profile['rejected_reasons'], sort_keys=True)}"
    )
    source = {
        "source_export_id": source_export_id,
        "source_system": SOURCE_SYSTEM,
        "source_file_name": path.name,
        "file_sha256": file_hash,
        "file_modified_at": file_modified.isoformat(),
        "row_count": profile["row_count"],
        "accepted_count": profile["accepted_count"],
        "rejected_count": profile["rejected_count"],
        "arrival_min": profile["arrival_min"],
        "arrival_max": profile["arrival_max"],
        "status": "loading",
        "notes": notes,
    }
    client.upsert("collision_repair_sources", source, "source_export_id")
    mappings = [
        {
            "source_system": SOURCE_SYSTEM,
            "source_shop_key": key,
            "source_shop_name": name,
        }
        for key, name in profile["shop_names"].items()
    ]
    client.upsert(
        "collision_shop_mappings",
        mappings,
        "source_system,source_shop_key",
        ignore=True,
    )

    try:
        uploaded = upload_facts(
            client,
            path,
            source_export_id,
            maximum_date,
            profile["accepted_count"],
            args.batch_size,
            args.workers,
        )
        finalized = client.request(
            "rpc/finalize_collision_repair_import",
            {"p_source_export_id": source_export_id},
        )
    except Exception:
        try:
            client.update_source(
                source_export_id,
                {"status": "failed", "notes": f"{notes} Import failed before final reconciliation."},
            )
        except Exception:
            pass
        raise

    return {
        "source_export_id": source_export_id,
        "status": "loaded",
        "rows": profile["row_count"],
        "accepted": uploaded,
        "rejected": profile["rejected_count"],
        "shops": len(mappings),
        "arrival_min": profile["arrival_min"],
        "arrival_max": profile["arrival_max"],
        "finalized": finalized,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-file")
    parser.add_argument("--env-file")
    parser.add_argument("--project-id", default="gylkkzmcmbdftxieyabw")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--max-file-age-hours", type=float)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), sort_keys=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
