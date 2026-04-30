"""Unit tests for customer geography geocoding helpers."""

from pathlib import Path

from customer_geography import (
    build_address_hash,
    build_one_line_address,
    census_geocode,
    geocode_repair_rows,
    google_geocode,
    load_address_csv_rows,
    refresh_zip_report,
)


class _FakeFetchOneResult:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return [self.value]


class _FakeConn:
    def __init__(self):
        self.calls: list[tuple[str, object | None]] = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        if "SELECT COUNT(*)::int" in sql:
            return _FakeFetchOneResult(7)
        return self


def test_address_hash_normalizes_whitespace_case_and_zip():
    row_a = {
        "address_line": " 12 Main St ",
        "customer_city": " Mineola ",
        "customer_state": "ny",
        "customer_zip": "11501-1234",
    }
    row_b = {
        "address_line": "12   MAIN st",
        "customer_city": "mineola",
        "customer_state": "NY",
        "customer_zip": "11501",
    }

    assert build_address_hash(row_a) == build_address_hash(row_b)
    assert build_one_line_address(row_a) == "12 Main St, Mineola NY 11501"


def test_census_geocode_returns_match_with_coordinates():
    def fetch_json(_url, _params):
        return {
            "result": {
                "addressMatches": [
                    {
                        "matchedAddress": "12 MAIN ST, MINEOLA, NY, 11501",
                        "coordinates": {"x": -73.6406, "y": 40.7492},
                    }
                ]
            }
        }

    result = census_geocode("12 Main St, Mineola NY 11501", fetch_json=fetch_json)

    assert result.status == "matched"
    assert result.provider == "census"
    assert result.latitude == 40.7492
    assert result.longitude == -73.6406
    assert result.location_wkt == "SRID=4326;POINT(-73.6406 40.7492)"


def test_google_geocode_requires_key_and_maps_success():
    missing = google_geocode("12 Main St, Mineola NY 11501", api_key=None)
    assert missing.status == "failed"
    assert missing.failure_reason == "google_api_key_missing"

    def fetch_json(_url, _params):
        return {
            "status": "OK",
            "results": [
                {
                    "formatted_address": "12 Main St, Mineola, NY 11501, USA",
                    "geometry": {
                        "location": {"lat": 40.7492, "lng": -73.6406},
                        "location_type": "ROOFTOP",
                    },
                }
            ],
        }

    success = google_geocode(
        "12 Main St, Mineola NY 11501",
        api_key="abc",
        fetch_json=fetch_json,
    )
    assert success.status == "matched"
    assert success.provider == "google"
    assert success.confidence == 0.95


def test_geocode_rows_uses_cache_then_fallback_and_respects_google_cap():
    rows = [
        {
            "repair_customer_id": 1,
            "repair_id": "r1",
            "shop_id": "s1",
            "shop_name": "Shop One",
            "repair_date": "2025-01-05",
            "address_line": "12 Main St",
            "customer_city": "Mineola",
            "customer_state": "NY",
            "customer_zip": "11501",
        },
        {
            "repair_customer_id": 2,
            "repair_id": "r2",
            "shop_id": "s1",
            "shop_name": "Shop One",
            "repair_date": "2025-01-06",
            "address_line": "404 Unknown Ave",
            "customer_city": "Mineola",
            "customer_state": "NY",
            "customer_zip": "11501",
        },
        {
            "repair_customer_id": 3,
            "repair_id": "r3",
            "shop_id": "s1",
            "shop_name": "Shop One",
            "repair_date": "2025-01-07",
            "address_line": "505 Limited Rd",
            "customer_city": "Mineola",
            "customer_state": "NY",
            "customer_zip": "11501",
        },
    ]

    cached_hash = build_address_hash(rows[0])
    cache = {
        cached_hash: {
            "geocode_provider": "census",
            "geocode_status": "matched",
            "geocode_confidence": 0.8,
            "latitude": 40.7492,
            "longitude": -73.6406,
            "formatted_address": "12 MAIN ST, MINEOLA, NY, 11501",
            "failure_reason": None,
            "raw_geocode_payload": {},
        }
    }

    def fake_fetch(url, params):
        if "geocoding.geo.census.gov" in url:
            return {"result": {"addressMatches": []}}
        if "maps.googleapis.com" in url and "404+Unknown+Ave" in params.get("address", "").replace(" ", "+"):
            return {
                "status": "OK",
                "results": [{
                    "formatted_address": "404 Unknown Ave, Mineola, NY 11501, USA",
                    "geometry": {"location": {"lat": 40.7400, "lng": -73.6200}, "location_type": "ROOFTOP"},
                }],
            }
        return {"status": "ZERO_RESULTS", "results": []}

    prepared, counts = geocode_repair_rows(
        rows,
        provider="census-google-fallback",
        google_api_key="abc",
        cached_by_hash=cache,
        max_google_calls=1,
        fetch_json=fake_fetch,
        import_batch_id="batch-1",
    )

    assert len(prepared) == 3
    assert counts["cache_hits"] == 1
    assert counts["census_calls"] == 2
    assert counts["google_calls"] == 1
    assert counts["matched"] == 2
    assert counts["failed"] == 1
    assert prepared[2]["failure_reason"] == "google_call_cap_reached"


def test_geocode_rows_skips_preparing_records_when_address_missing():
    rows = [
        {
            "repair_customer_id": 99,
            "repair_id": "missing-1",
            "shop_id": "s1",
            "shop_name": "Shop One",
            "repair_date": "2025-01-05",
            "address_line": "",
            "customer_city": "Mineola",
            "customer_state": "NY",
            "customer_zip": "11501",
        }
    ]

    prepared, counts = geocode_repair_rows(
        rows,
        provider="census-google-fallback",
        google_api_key="abc",
        cached_by_hash={},
        import_batch_id="batch-1",
    )

    assert prepared == []
    assert counts["missing_address"] == 1
    assert counts["census_calls"] == 0
    assert counts["google_calls"] == 0


def test_load_address_csv_rows_maps_common_field_variants(tmp_path: Path):
    csv_path = tmp_path / "addresses.csv"
    csv_path.write_text(
        "repair_id,address,city,state,postal_code\n"
        "R-1,12 Main St,Mineola,NY,11501-1234\n",
        encoding="utf-8",
    )

    rows = load_address_csv_rows(csv_path, match_column="repair_id")

    assert len(rows) == 1
    assert rows[0]["match_value"] == "R-1"
    assert rows[0]["customer_address"] == "12 Main St"
    assert rows[0]["customer_city"] == "Mineola"
    assert rows[0]["customer_state"] == "NY"
    assert rows[0]["customer_zip"] == "11501-1234"


def test_refresh_zip_report_uses_latest_available_income_year_fallback():
    conn = _FakeConn()

    result = refresh_zip_report(
        conn,
        start_date="2024-01-01",
        end_date="2024-12-31",
        import_batch_id="batch-1",
    )

    refresh_sql, refresh_params = conn.calls[0]

    assert "LEFT JOIN LATERAL (" in refresh_sql
    assert "WHERE i.zip = r.zip" in refresh_sql
    assert "AND i.year <= EXTRACT(YEAR FROM r.month)::int" in refresh_sql
    assert "ORDER BY i.year DESC" in refresh_sql
    assert "LIMIT 1" in refresh_sql
    assert refresh_params == ("2024-01-01", "2024-12-31", "batch-1")
    assert result["rows_inserted"] == 7
