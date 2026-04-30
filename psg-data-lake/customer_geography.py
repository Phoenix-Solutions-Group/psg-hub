#!/usr/bin/env python3
"""Geocode repair customer addresses for PSG customer geography reporting."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlencode
from urllib.request import urlopen

from psycopg.rows import dict_row

from supabase_migration import clean_copy_value, connect
from utils.normalize import normalize_zip


CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
GOOGLE_GEOCODER_URL = "https://maps.googleapis.com/maps/api/geocode/json"

GEOLOCATION_COPY_COLUMNS = [
    "repair_customer_id",
    "repair_id",
    "shop_id",
    "shop_name",
    "repair_date",
    "customer_zip",
    "customer_city",
    "customer_state",
    "address_hash",
    "latitude",
    "longitude",
    "location",
    "geocode_provider",
    "geocode_status",
    "geocode_confidence",
    "formatted_address",
    "failure_reason",
    "raw_geocode_payload",
    "import_batch_id",
]


@dataclass(frozen=True)
class GeocodeResult:
    status: str
    provider: str
    latitude: float | None
    longitude: float | None
    confidence: float | None
    formatted_address: str | None
    failure_reason: str | None
    raw_payload: dict[str, Any]

    @property
    def location_wkt(self) -> str | None:
        if self.latitude is None or self.longitude is None:
            return None
        return f"SRID=4326;POINT({self.longitude} {self.latitude})"


def today_iso() -> str:
    return datetime.now(tz=UTC).date().isoformat()


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def normalize_state(value: Any) -> str:
    return normalize_text(value).upper()[:2]


def normalize_address_line(value: Any) -> str:
    return normalize_text(value)


def address_key_parts(row: dict[str, Any]) -> tuple[str, str, str, str]:
    line = normalize_address_line(row.get("address_line"))
    city = normalize_text(row.get("customer_city"))
    state = normalize_state(row.get("customer_state"))
    zip_code = normalize_zip(row.get("customer_zip")) or ""
    return line, city, state, zip_code


def build_address_hash(row: dict[str, Any]) -> str | None:
    line, city, state, zip_code = address_key_parts(row)
    if not line:
        return None
    normalized = "|".join(part.lower() for part in (line, city, state, zip_code))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def build_one_line_address(row: dict[str, Any]) -> str | None:
    line, city, state, zip_code = address_key_parts(row)
    if not line:
        return None
    city_state_zip = " ".join(part for part in (city, state, zip_code) if part)
    if city_state_zip:
        return f"{line}, {city_state_zip}"
    return line


def clean_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        numeric = float(str(value).strip())
    except ValueError:
        return None
    if not (-180 <= numeric <= 180):
        return None
    return numeric


def http_get_json(url: str, params: dict[str, Any], *, timeout: int = 45) -> dict[str, Any]:
    query = urlencode({key: value for key, value in params.items() if value not in (None, "")})
    full_url = f"{url}?{query}"
    with urlopen(full_url, timeout=timeout) as response:
        payload = response.read().decode("utf-8")
    parsed = json.loads(payload)
    if isinstance(parsed, dict):
        return parsed
    raise ValueError("Unexpected JSON payload")


def census_geocode(
    one_line_address: str,
    *,
    fetch_json: Any = http_get_json,
) -> GeocodeResult:
    payload = fetch_json(CENSUS_GEOCODER_URL, {
        "address": one_line_address,
        "benchmark": "Public_AR_Current",
        "format": "json",
    })
    result = payload.get("result") if isinstance(payload, dict) else None
    matches = result.get("addressMatches", []) if isinstance(result, dict) else []
    if matches:
        first = matches[0]
        coordinates = first.get("coordinates", {})
        lat = clean_float(coordinates.get("y"))
        lng = clean_float(coordinates.get("x"))
        if lat is not None and lng is not None:
            return GeocodeResult(
                status="matched",
                provider="census",
                latitude=lat,
                longitude=lng,
                confidence=0.8,
                formatted_address=first.get("matchedAddress"),
                failure_reason=None,
                raw_payload=payload,
            )
    return GeocodeResult(
        status="unmatched",
        provider="census",
        latitude=None,
        longitude=None,
        confidence=None,
        formatted_address=None,
        failure_reason="census_no_match",
        raw_payload=payload,
    )


def google_geocode(
    one_line_address: str,
    *,
    api_key: str | None,
    fetch_json: Any = http_get_json,
) -> GeocodeResult:
    if not api_key:
        return GeocodeResult(
            status="failed",
            provider="google",
            latitude=None,
            longitude=None,
            confidence=None,
            formatted_address=None,
            failure_reason="google_api_key_missing",
            raw_payload={},
        )
    payload = fetch_json(GOOGLE_GEOCODER_URL, {
        "address": one_line_address,
        "key": api_key,
    })
    status = str(payload.get("status") or "")
    results = payload.get("results", []) if isinstance(payload, dict) else []
    if status == "OK" and results:
        first = results[0]
        location = first.get("geometry", {}).get("location", {})
        lat = clean_float(location.get("lat"))
        lng = clean_float(location.get("lng"))
        if lat is not None and lng is not None:
            location_type = str(first.get("geometry", {}).get("location_type") or "")
            confidence = 0.95 if location_type in {"ROOFTOP", "RANGE_INTERPOLATED"} else 0.88
            return GeocodeResult(
                status="matched",
                provider="google",
                latitude=lat,
                longitude=lng,
                confidence=confidence,
                formatted_address=first.get("formatted_address"),
                failure_reason=None,
                raw_payload=payload,
            )
    return GeocodeResult(
        status="unmatched",
        provider="google",
        latitude=None,
        longitude=None,
        confidence=None,
        formatted_address=None,
        failure_reason=f"google_status_{status.lower() or 'unknown'}",
        raw_payload=payload,
    )


def geocode_with_provider(
    one_line_address: str,
    *,
    provider: str,
    google_api_key: str | None,
    fetch_json: Any = http_get_json,
) -> GeocodeResult:
    if provider == "census":
        return census_geocode(one_line_address, fetch_json=fetch_json)
    if provider == "google":
        return google_geocode(one_line_address, api_key=google_api_key, fetch_json=fetch_json)
    if provider != "census-google-fallback":
        raise ValueError(f"Unsupported provider: {provider}")
    census_result = census_geocode(one_line_address, fetch_json=fetch_json)
    if census_result.status == "matched":
        return census_result
    return google_geocode(one_line_address, api_key=google_api_key, fetch_json=fetch_json)


def fetch_repair_rows(
    conn,
    *,
    start_date: str,
    end_date: str,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    sql = """
        SELECT
            rc.id AS repair_customer_id,
            rc.repair_id,
            rc.shop_id,
            rc.shop_name,
            COALESCE(rc.date_out, rc.date_in, rc.creation_date) AS repair_date,
            COALESCE(
              NULLIF(rc.raw_payload->>'customer_address', ''),
              NULLIF(rc.raw_payload->>'customer_address1', ''),
              NULLIF(rc.raw_payload->>'owner_address1', ''),
              NULLIF(rc.raw_payload->>'OwnerAddress1', '')
            ) AS address_line,
            COALESCE(
              NULLIF(rc.raw_payload->>'customer_city', ''),
              NULLIF(rc.raw_payload->>'owner_city', ''),
              NULLIF(rc.raw_payload->>'OwnerCity', '')
            ) AS customer_city,
            COALESCE(
              NULLIF(rc.raw_payload->>'customer_state', ''),
              NULLIF(rc.raw_payload->>'owner_state', ''),
              NULLIF(rc.raw_payload->>'OwnerStateProvince', '')
            ) AS customer_state,
            COALESCE(
              NULLIF(rc.raw_payload->>'customer_zip', ''),
              NULLIF(rc.raw_payload->>'owner_zip', ''),
              NULLIF(rc.raw_payload->>'OwnerPostalZip', '')
            ) AS customer_zip
        FROM sensitive.repair_customers rc
        WHERE COALESCE(rc.date_out, rc.date_in, rc.creation_date) BETWEEN %s::date AND %s::date
        ORDER BY COALESCE(rc.date_out, rc.date_in, rc.creation_date), rc.id
    """
    with conn.cursor(row_factory=dict_row) as cur:
        if limit is not None:
            sql += " LIMIT %s"
            cur.execute(sql, (start_date, end_date, limit))
        else:
            cur.execute(sql, (start_date, end_date))
        rows = cur.fetchall()
    return [dict(row) for row in rows]


def csv_value(row: dict[str, Any], candidates: list[str]) -> str:
    for key in candidates:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return ""


def load_address_csv_rows(csv_path: Path, *, match_column: str) -> list[dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        loaded: list[dict[str, str]] = []
        for raw in reader:
            loaded.append({
                "match_value": csv_value(raw, [match_column]),
                "customer_address": csv_value(raw, [
                    "customer_address", "customer_address1", "address", "address1",
                    "owner_address", "owner_address1", "OwnerAddress1",
                ]),
                "customer_city": csv_value(raw, ["customer_city", "city", "owner_city", "OwnerCity"]),
                "customer_state": csv_value(raw, ["customer_state", "state", "owner_state", "OwnerStateProvince"]),
                "customer_zip": csv_value(raw, ["customer_zip", "zip", "postal_code", "owner_zip", "OwnerPostalZip"]),
            })
    return loaded


def import_addresses_csv(
    conn,
    *,
    csv_path: Path,
    match_column: str,
    dry_run: bool,
) -> dict[str, Any]:
    match_sql_column = {
        "repair_id": "repair_id",
        "match_key": "match_key",
        "ro_number": "ro_number",
    }.get(match_column)
    if not match_sql_column:
        raise ValueError(f"Unsupported match column: {match_column}")

    rows = load_address_csv_rows(csv_path, match_column=match_column)
    rows_with_match = [row for row in rows if row["match_value"]]
    rows_with_address = [row for row in rows_with_match if any(
        [row["customer_address"], row["customer_city"], row["customer_state"], row["customer_zip"]]
    )]

    if dry_run:
        return {
            "csv_path": str(csv_path),
            "match_column": match_column,
            "dry_run": True,
            "rows_read": len(rows),
            "rows_with_match_value": len(rows_with_match),
            "rows_with_address_fields": len(rows_with_address),
            "rows_applied": 0,
        }

    conn.execute(
        """
        CREATE TEMP TABLE customer_address_import_stage (
          match_value TEXT,
          customer_address TEXT,
          customer_city TEXT,
          customer_state TEXT,
          customer_zip TEXT
        ) ON COMMIT DROP
        """
    )
    with conn.cursor() as cur:
        with cur.copy(
            """
            COPY customer_address_import_stage (
              match_value, customer_address, customer_city, customer_state, customer_zip
            ) FROM STDIN
            """
        ) as copy:
            for row in rows_with_address:
                copy.write_row([
                    row["match_value"],
                    row["customer_address"] or None,
                    row["customer_city"] or None,
                    row["customer_state"] or None,
                    normalize_zip(row["customer_zip"]),
                ])

    updated = conn.execute(
        f"""
        WITH canonical AS (
          SELECT
            match_value,
            MAX(NULLIF(customer_address, '')) AS customer_address,
            MAX(NULLIF(customer_city, '')) AS customer_city,
            MAX(NULLIF(customer_state, '')) AS customer_state,
            MAX(NULLIF(customer_zip, '')) AS customer_zip
          FROM customer_address_import_stage
          WHERE NULLIF(match_value, '') IS NOT NULL
          GROUP BY match_value
        )
        UPDATE sensitive.repair_customers rc
        SET raw_payload = COALESCE(rc.raw_payload, '{{}}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'customer_address', canonical.customer_address,
            'customer_city', canonical.customer_city,
            'customer_state', canonical.customer_state,
            'customer_zip', canonical.customer_zip
          )
        ),
        source_loaded_at = COALESCE(rc.source_loaded_at, NOW())
        FROM canonical
        WHERE rc.{match_sql_column} = canonical.match_value
        """
    ).rowcount

    return {
        "csv_path": str(csv_path),
        "match_column": match_column,
        "dry_run": False,
        "rows_read": len(rows),
        "rows_with_match_value": len(rows_with_match),
        "rows_with_address_fields": len(rows_with_address),
        "rows_applied": int(updated or 0),
    }


def fetch_cached_geocodes(conn, address_hashes: Iterable[str]) -> dict[str, dict[str, Any]]:
    hashes = sorted({hash_value for hash_value in address_hashes if hash_value})
    if not hashes:
        return {}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (address_hash)
              address_hash,
              latitude,
              longitude,
              geocode_provider,
              geocode_status,
              geocode_confidence,
              formatted_address,
              failure_reason,
              raw_geocode_payload
            FROM sensitive.repair_customer_locations
            WHERE address_hash = ANY(%s)
            ORDER BY address_hash, imported_at DESC
            """,
            (hashes,),
        )
        rows = cur.fetchall()
    return {str(row["address_hash"]): dict(row) for row in rows}


def prepare_cache_result(cached_row: dict[str, Any]) -> GeocodeResult:
    status = str(cached_row.get("geocode_status") or "cached")
    return GeocodeResult(
        status="matched" if status == "matched" else status,
        provider=str(cached_row.get("geocode_provider") or "cache"),
        latitude=float(cached_row["latitude"]) if cached_row.get("latitude") is not None else None,
        longitude=float(cached_row["longitude"]) if cached_row.get("longitude") is not None else None,
        confidence=float(cached_row["geocode_confidence"]) if cached_row.get("geocode_confidence") is not None else None,
        formatted_address=clean_copy_value(cached_row.get("formatted_address")),
        failure_reason=clean_copy_value(cached_row.get("failure_reason")),
        raw_payload=cached_row.get("raw_geocode_payload") or {},
    )


def build_geocode_row(
    repair_row: dict[str, Any],
    *,
    address_hash: str | None,
    result: GeocodeResult,
    import_batch_id: str,
) -> dict[str, Any]:
    return {
        "repair_customer_id": repair_row.get("repair_customer_id"),
        "repair_id": clean_copy_value(repair_row.get("repair_id")),
        "shop_id": clean_copy_value(repair_row.get("shop_id")),
        "shop_name": clean_copy_value(repair_row.get("shop_name")),
        "repair_date": clean_copy_value(repair_row.get("repair_date")),
        "customer_zip": normalize_zip(repair_row.get("customer_zip")),
        "customer_city": normalize_text(repair_row.get("customer_city")) or None,
        "customer_state": normalize_state(repair_row.get("customer_state")) or None,
        "address_hash": address_hash,
        "latitude": result.latitude,
        "longitude": result.longitude,
        "location": result.location_wkt,
        "geocode_provider": result.provider,
        "geocode_status": "matched" if result.latitude is not None and result.longitude is not None else result.status,
        "geocode_confidence": result.confidence,
        "formatted_address": clean_copy_value(result.formatted_address),
        "failure_reason": clean_copy_value(result.failure_reason),
        "raw_geocode_payload": json.dumps(result.raw_payload, sort_keys=True, default=str),
        "import_batch_id": import_batch_id,
    }


def upsert_geocode_rows(conn, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    conn.execute(
        "CREATE TEMP TABLE repair_customer_locations_stage (LIKE sensitive.repair_customer_locations INCLUDING DEFAULTS) ON COMMIT DROP"
    )
    column_sql = ", ".join(GEOLOCATION_COPY_COLUMNS)
    copy_sql = f"COPY repair_customer_locations_stage ({column_sql}) FROM STDIN"
    copied = 0
    with conn.cursor() as cur:
        with cur.copy(copy_sql) as copy:
            for row in rows:
                copy.write_row([row.get(column) for column in GEOLOCATION_COPY_COLUMNS])
                copied += 1
    columns = ", ".join(GEOLOCATION_COPY_COLUMNS)
    updates = ", ".join(
        f"{column} = EXCLUDED.{column}"
        for column in GEOLOCATION_COPY_COLUMNS
        if column != "repair_customer_id"
    )
    conn.execute(
        f"""
        INSERT INTO sensitive.repair_customer_locations ({columns})
        SELECT {columns}
        FROM repair_customer_locations_stage
        WHERE repair_customer_id IS NOT NULL
        ON CONFLICT (repair_customer_id)
        DO UPDATE SET {updates}, imported_at = NOW()
        """
    )
    return copied


def geocode_repair_rows(
    repair_rows: list[dict[str, Any]],
    *,
    provider: str,
    google_api_key: str | None,
    cached_by_hash: dict[str, dict[str, Any]] | None = None,
    max_google_calls: int | None = None,
    fetch_json: Any = http_get_json,
    import_batch_id: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    cached_lookup = cached_by_hash or {}
    in_run_cache: dict[str, GeocodeResult] = {}
    geocode_rows: list[dict[str, Any]] = []
    counters = {
        "total_rows": len(repair_rows),
        "missing_address": 0,
        "cache_hits": 0,
        "census_calls": 0,
        "google_calls": 0,
        "matched": 0,
        "unmatched": 0,
        "failed": 0,
    }
    google_calls = 0
    google_cap = max_google_calls if max_google_calls is not None and max_google_calls >= 0 else None

    for repair_row in repair_rows:
        address_hash = build_address_hash(repair_row)
        one_line = build_one_line_address(repair_row)
        if not one_line:
            counters["missing_address"] += 1
            continue

        if address_hash and address_hash in in_run_cache:
            counters["cache_hits"] += 1
            cached_result = in_run_cache[address_hash]
            geocode_rows.append(build_geocode_row(
                repair_row,
                address_hash=address_hash,
                result=cached_result,
                import_batch_id=import_batch_id,
            ))
            if cached_result.latitude is not None and cached_result.longitude is not None:
                counters["matched"] += 1
            elif cached_result.status == "failed":
                counters["failed"] += 1
            else:
                counters["unmatched"] += 1
            continue

        if address_hash and address_hash in cached_lookup:
            counters["cache_hits"] += 1
            cached_result = prepare_cache_result(cached_lookup[address_hash])
            in_run_cache[address_hash] = cached_result
            geocode_rows.append(build_geocode_row(
                repair_row,
                address_hash=address_hash,
                result=cached_result,
                import_batch_id=import_batch_id,
            ))
            if cached_result.latitude is not None and cached_result.longitude is not None:
                counters["matched"] += 1
            else:
                counters["unmatched"] += 1
            continue

        if provider in {"census", "census-google-fallback"}:
            counters["census_calls"] += 1
            census_result = census_geocode(one_line, fetch_json=fetch_json)
            if address_hash:
                in_run_cache[address_hash] = census_result
            if census_result.latitude is not None and census_result.longitude is not None:
                geocode_rows.append(build_geocode_row(
                    repair_row,
                    address_hash=address_hash,
                    result=census_result,
                    import_batch_id=import_batch_id,
                ))
                counters["matched"] += 1
                continue
            if provider == "census":
                geocode_rows.append(build_geocode_row(
                    repair_row,
                    address_hash=address_hash,
                    result=census_result,
                    import_batch_id=import_batch_id,
                ))
                counters["unmatched"] += 1
                continue

        if provider in {"google", "census-google-fallback"}:
            if google_cap is not None and google_calls >= google_cap:
                capped = GeocodeResult(
                    status="skipped",
                    provider="google",
                    latitude=None,
                    longitude=None,
                    confidence=None,
                    formatted_address=None,
                    failure_reason="google_call_cap_reached",
                    raw_payload={},
                )
                if address_hash:
                    in_run_cache[address_hash] = capped
                geocode_rows.append(build_geocode_row(
                    repair_row,
                    address_hash=address_hash,
                    result=capped,
                    import_batch_id=import_batch_id,
                ))
                counters["failed"] += 1
                continue
            counters["google_calls"] += 1
            google_calls += 1
            google_result = google_geocode(one_line, api_key=google_api_key, fetch_json=fetch_json)
            if address_hash:
                in_run_cache[address_hash] = google_result
            geocode_rows.append(build_geocode_row(
                repair_row,
                address_hash=address_hash,
                result=google_result,
                import_batch_id=import_batch_id,
            ))
            if google_result.latitude is not None and google_result.longitude is not None:
                counters["matched"] += 1
            elif google_result.status == "failed":
                counters["failed"] += 1
            else:
                counters["unmatched"] += 1
            continue

        raise ValueError(f"Unsupported provider: {provider}")

    return geocode_rows, counters


def inspect_repairs(
    conn,
    *,
    start_date: str,
    end_date: str,
    limit: int | None = None,
) -> dict[str, Any]:
    repair_rows = fetch_repair_rows(conn, start_date=start_date, end_date=end_date, limit=limit)
    address_hashes = [build_address_hash(row) for row in repair_rows]
    cached_by_hash = fetch_cached_geocodes(conn, address_hashes)
    geocodable = sum(1 for row in repair_rows if build_one_line_address(row))
    unique_hashes = len({hash_value for hash_value in address_hashes if hash_value})
    cached_hashes = sum(1 for hash_value in {hash_value for hash_value in address_hashes if hash_value} if hash_value in cached_by_hash)
    return {
        "start_date": start_date,
        "end_date": end_date,
        "rows_scanned": len(repair_rows),
        "geocodable_rows": geocodable,
        "rows_missing_address": len(repair_rows) - geocodable,
        "unique_address_hashes": unique_hashes,
        "cached_hashes": cached_hashes,
        "uncached_hashes": max(unique_hashes - cached_hashes, 0),
    }


def run_geocode_command(
    conn,
    *,
    start_date: str,
    end_date: str,
    provider: str,
    limit: int | None,
    dry_run: bool,
    google_api_key: str | None,
    max_google_calls: int | None,
) -> dict[str, Any]:
    repair_rows = fetch_repair_rows(conn, start_date=start_date, end_date=end_date, limit=limit)
    address_hashes = [build_address_hash(row) for row in repair_rows]
    cached_by_hash = fetch_cached_geocodes(conn, address_hashes)
    import_batch_id = f"customer-geocode-{datetime.now(tz=UTC).strftime('%Y%m%d%H%M%S')}"
    geocode_rows, counters = geocode_repair_rows(
        repair_rows,
        provider=provider,
        google_api_key=google_api_key,
        cached_by_hash=cached_by_hash,
        max_google_calls=max_google_calls,
        import_batch_id=import_batch_id,
    )
    rows_to_write = geocode_rows if not dry_run else []
    written = 0
    if rows_to_write:
        written = upsert_geocode_rows(conn, rows_to_write)
    return {
        "start_date": start_date,
        "end_date": end_date,
        "provider": provider,
        "dry_run": dry_run,
        "rows_considered": len(repair_rows),
        "rows_prepared": len(geocode_rows),
        "rows_written": written,
        "import_batch_id": import_batch_id,
        "counts": counters,
    }


def refresh_zip_report(conn, *, start_date: str, end_date: str, import_batch_id: str) -> dict[str, Any]:
    sql = """
        WITH bounds AS (
          SELECT %s::date AS start_date, %s::date AS end_date
        ),
        deleted AS (
          DELETE FROM public.customer_zip_report_monthly c
          USING bounds b
          WHERE c.month BETWEEN DATE_TRUNC('month', b.start_date)::date
                            AND DATE_TRUNC('month', b.end_date)::date
          RETURNING 1
        ),
        base AS (
          SELECT
            DATE_TRUNC('month', COALESCE(rcl.repair_date, rc.date_out, rc.date_in, rc.creation_date))::date AS month,
            COALESCE(NULLIF(rcl.shop_id, ''), NULLIF(rc.shop_id, ''), 'unknown') AS shop_id,
            COALESCE(NULLIF(rcl.shop_name, ''), NULLIF(rc.shop_name, ''), 'Unknown Shop') AS shop_name,
            COALESCE(
              NULLIF(rcl.customer_zip, ''),
              NULLIF(REGEXP_REPLACE(COALESCE(rc.raw_payload->>'customer_zip', ''), '[^0-9]', '', 'g'), ''),
              '__UNMATCHED__'
            ) AS zip,
            COALESCE(
              NULLIF(rcl.customer_state, ''),
              NULLIF(rc.raw_payload->>'customer_state', ''),
              ''
            ) AS state,
            rc.repair_total::numeric AS repair_total,
            COALESCE(NULLIF(rcl.address_hash, ''), CONCAT('repair:', rc.id::text)) AS household_key
          FROM sensitive.repair_customers rc
          LEFT JOIN sensitive.repair_customer_locations rcl
            ON rcl.repair_customer_id = rc.id
          JOIN bounds b ON TRUE
          WHERE COALESCE(rcl.repair_date, rc.date_out, rc.date_in, rc.creation_date) BETWEEN b.start_date AND b.end_date
        ),
        rollup AS (
          SELECT
            b.month,
            b.shop_id,
            MAX(b.shop_name) AS shop_name,
            b.zip,
            MAX(b.state) AS state,
            COUNT(*)::bigint AS repair_count,
            COUNT(DISTINCT b.household_key)::bigint AS unique_household_count,
            AVG(b.repair_total) AS avg_repair_total,
            SUM(b.repair_total) AS total_repair_value
          FROM base b
          GROUP BY b.month, b.shop_id, b.zip
        ),
        income AS (
          SELECT
            z.year,
            z.zip,
            MAX(z.mean_household_income) AS mean_household_income,
            MAX(z.median_household_income) AS median_household_income
          FROM public.zcta_income_annual z
          GROUP BY z.year, z.zip
        ),
        crash AS (
          SELECT
            c.year,
            c.zip,
            SUM(c.weighted_crash_demand_score)::numeric AS crash_demand_score
          FROM crash_zip_annual c
          WHERE c.zip <> '__UNMATCHED__'
          GROUP BY c.year, c.zip
        ),
        storm AS (
          SELECT
            EXTRACT(YEAR FROM s.month)::int AS year,
            s.zip,
            SUM(s.weighted_storm_demand_score)::numeric AS storm_demand_score
          FROM storm_zip_monthly s
          WHERE s.zip <> '__UNMATCHED__'
          GROUP BY EXTRACT(YEAR FROM s.month)::int, s.zip
        ),
        est_veh AS (
          SELECT e.zip, e.estimated_total_vehicles, e.data_quality_flag, e.ev_count, e.ev_pct
          FROM public.estimated_zip_vehicles e
          WHERE e.year = (SELECT MAX(year) FROM public.estimated_zip_vehicles)
        ),
        dmv AS (
          SELECT
            d.zip,
            d.vehicle_count
          FROM public.dmv_vehicle_registrations d
          WHERE d.snapshot_date = (
            SELECT MAX(d2.snapshot_date)
            FROM public.dmv_vehicle_registrations d2
            WHERE d2.zip = d.zip
          )
        ),
        shops AS (
          SELECT
            SUBSTRING(bs.address FROM '([0-9]{5})') AS zip,
            COUNT(*)::int AS shop_count
          FROM public.body_shops bs
          WHERE bs.address ~ '[0-9]{5}'
          GROUP BY SUBSTRING(bs.address FROM '([0-9]{5})')
        )
        INSERT INTO public.customer_zip_report_monthly (
          month,
          shop_id,
          shop_name,
          zip,
          county_name,
          state,
          repair_count,
          unique_household_count,
          avg_repair_total,
          total_repair_value,
          mean_household_income,
          median_household_income,
          income_band,
          crash_demand_score,
          storm_demand_score,
          market_opportunity_score,
          registered_vehicles,
          ev_vehicle_count,
          competitor_shop_count,
          import_batch_id
        )
        SELECT
          r.month,
          r.shop_id,
          r.shop_name,
          r.zip,
          c.county_name,
          r.state,
          r.repair_count,
          r.unique_household_count,
          ROUND(r.avg_repair_total, 2),
          ROUND(r.total_repair_value, 2),
          i.mean_household_income,
          i.median_household_income,
          CASE
            WHEN i.mean_household_income IS NULL THEN 'unknown'
            WHEN i.mean_household_income >= 200000 THEN '200k+'
            WHEN i.mean_household_income >= 150000 THEN '150k-199k'
            WHEN i.mean_household_income >= 100000 THEN '100k-149k'
            WHEN i.mean_household_income >= 75000 THEN '75k-99k'
            WHEN i.mean_household_income >= 50000 THEN '50k-74k'
            ELSE '<50k'
          END AS income_band,
          COALESCE(cr.crash_demand_score, 0) AS crash_demand_score,
          COALESCE(st.storm_demand_score, 0) AS storm_demand_score,
          ROUND(
            (
              (r.repair_count::numeric * 10)
              + COALESCE(cr.crash_demand_score, 0)
              + (COALESCE(st.storm_demand_score, 0) * 0.35)
            ),
            2
          ) AS market_opportunity_score,
          COALESCE(est_veh.estimated_total_vehicles, dmv.vehicle_count) AS registered_vehicles,
          est_veh.ev_count AS ev_vehicle_count,
          shops.shop_count AS competitor_shop_count,
          %s::text AS import_batch_id
        FROM rollup r
        LEFT JOIN LATERAL (
          SELECT
            i.year,
            i.mean_household_income,
            i.median_household_income
          FROM income i
          WHERE i.zip = r.zip
            AND i.year <= EXTRACT(YEAR FROM r.month)::int
          ORDER BY i.year DESC
          LIMIT 1
        ) i ON TRUE
        LEFT JOIN crash cr
          ON cr.year = EXTRACT(YEAR FROM r.month)::int
         AND cr.zip = r.zip
        LEFT JOIN storm st
          ON st.year = EXTRACT(YEAR FROM r.month)::int
         AND st.zip = r.zip
        LEFT JOIN county_references c
          ON c.county_fips = (
            SELECT zr.county_fips
            FROM zip_references zr
            WHERE zr.zip_code = r.zip
            LIMIT 1
          )
        LEFT JOIN est_veh
          ON est_veh.zip = r.zip
        LEFT JOIN dmv
          ON dmv.zip = r.zip
        LEFT JOIN shops
          ON shops.zip = r.zip
        ON CONFLICT (month, shop_id, zip)
        DO UPDATE SET
          shop_name = EXCLUDED.shop_name,
          county_name = EXCLUDED.county_name,
          state = EXCLUDED.state,
          repair_count = EXCLUDED.repair_count,
          unique_household_count = EXCLUDED.unique_household_count,
          avg_repair_total = EXCLUDED.avg_repair_total,
          total_repair_value = EXCLUDED.total_repair_value,
          mean_household_income = EXCLUDED.mean_household_income,
          median_household_income = EXCLUDED.median_household_income,
          income_band = EXCLUDED.income_band,
          crash_demand_score = EXCLUDED.crash_demand_score,
          storm_demand_score = EXCLUDED.storm_demand_score,
          market_opportunity_score = EXCLUDED.market_opportunity_score,
          registered_vehicles = EXCLUDED.registered_vehicles,
          ev_vehicle_count = EXCLUDED.ev_vehicle_count,
          competitor_shop_count = EXCLUDED.competitor_shop_count,
          import_batch_id = EXCLUDED.import_batch_id;
    """
    conn.execute(sql, (start_date, end_date, import_batch_id))
    inserted = conn.execute(
        """
        SELECT COUNT(*)::int
        FROM public.customer_zip_report_monthly
        WHERE import_batch_id = %s
        """,
        (import_batch_id,),
    ).fetchone()[0]
    return {
        "start_date": start_date,
        "end_date": end_date,
        "import_batch_id": import_batch_id,
        "rows_inserted": int(inserted),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    inspect = subcommands.add_parser("inspect-repairs")
    inspect.add_argument("--start-date", default="2024-01-01")
    inspect.add_argument("--end-date", default=today_iso())
    inspect.add_argument("--limit", type=int)

    geocode = subcommands.add_parser("geocode-repairs")
    geocode.add_argument("--start-date", default="2024-01-01")
    geocode.add_argument("--end-date", default=today_iso())
    geocode.add_argument("--provider", choices=["census", "google", "census-google-fallback"], default="census-google-fallback")
    geocode.add_argument("--limit", type=int)
    geocode.add_argument("--dry-run", action="store_true")
    geocode.add_argument("--apply", action="store_true")
    geocode.add_argument("--max-google-calls", type=int, default=int(os.getenv("GEOCODER_MAX_GOOGLE_CALLS", "500")))

    import_addresses = subcommands.add_parser("import-addresses-csv")
    import_addresses.add_argument("--csv-path", type=Path, required=True)
    import_addresses.add_argument("--match-column", choices=["repair_id", "match_key", "ro_number"], default="repair_id")
    import_addresses.add_argument("--dry-run", action="store_true")
    import_addresses.add_argument("--apply", action="store_true")

    refresh = subcommands.add_parser("refresh-zip-report")
    refresh.add_argument("--start-date", default="2024-01-01")
    refresh.add_argument("--end-date", default=today_iso())
    return parser


def validate_iso_date(value: str) -> str:
    date.fromisoformat(value)
    return value


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    with connect(args.database_url) as conn:
        if args.command in {"inspect-repairs", "geocode-repairs", "refresh-zip-report"}:
            start_date = validate_iso_date(args.start_date)
            end_date = validate_iso_date(args.end_date)
            if start_date > end_date:
                parser.error("--start-date must be <= --end-date")
        else:
            start_date = None
            end_date = None

        if args.command == "inspect-repairs":
            result = inspect_repairs(
                conn,
                start_date=start_date,
                end_date=end_date,
                limit=args.limit,
            )
            print(json.dumps(result, indent=2, default=str))
            return 0

        if args.command == "import-addresses-csv":
            dry_run = True if (not args.apply and not args.dry_run) else args.dry_run
            if args.apply:
                dry_run = False
            result = import_addresses_csv(
                conn,
                csv_path=args.csv_path,
                match_column=args.match_column,
                dry_run=dry_run,
            )
            print(json.dumps(result, indent=2, default=str))
            return 0

        if args.command == "refresh-zip-report":
            batch_id = f"customer-zip-report-{datetime.now(tz=UTC).strftime('%Y%m%d%H%M%S')}"
            result = refresh_zip_report(
                conn,
                start_date=start_date,
                end_date=end_date,
                import_batch_id=batch_id,
            )
            print(json.dumps(result, indent=2, default=str))
            return 0

        dry_run = True if (not args.apply and not args.dry_run) else args.dry_run
        if args.apply:
            dry_run = False
        result = run_geocode_command(
            conn,
            start_date=start_date,
            end_date=end_date,
            provider=args.provider,
            limit=args.limit,
            dry_run=dry_run,
            google_api_key=os.getenv("GOOGLE_GEOCODING_API_KEY"),
            max_google_calls=args.max_google_calls,
        )
        print(json.dumps(result, indent=2, default=str))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
