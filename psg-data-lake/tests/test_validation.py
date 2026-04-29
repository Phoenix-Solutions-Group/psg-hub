"""Integration tests for data lake validation -- row counts, bounds, join coverage."""

import pytest

from config import PROJECT_ID, DATASET_ID


# ---------------------------------------------------------------------------
# Expected row count ranges per table
# ---------------------------------------------------------------------------

EXPECTED_RANGES = {
    "accidents": (7_700_000, 7_800_000),
    "zipcode_boundaries": (33_000, 34_000),
    "zip_reference": (33_000, 34_000),
    "state_reference": (50, 60),
    "county_reference": (3_000, 3_500),
    "zcta_zip_mapping": (40_000, 42_000),
    "accident_density": (1, None),  # > 0
}


# ---------------------------------------------------------------------------
# VAL-01: Row counts
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_row_counts(bq_client):
    """Each table's num_rows falls within expected range."""
    failures = []
    for table_name, (lo, hi) in EXPECTED_RANGES.items():
        table_ref = f"{PROJECT_ID}.{DATASET_ID}.{table_name}"
        table = bq_client.get_table(table_ref)
        count = table.num_rows
        if hi is None:
            if count < lo:
                failures.append(f"{table_name}: {count} < {lo}")
        elif not (lo <= count <= hi):
            failures.append(f"{table_name}: {count} not in [{lo}, {hi}]")
    assert not failures, "Row count failures:\n" + "\n".join(failures)


# ---------------------------------------------------------------------------
# VAL-02: Geographic bounds
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_us_bounds(bq_client):
    """Zero accident points outside US bounding box (lat 24-72, lng -180 to -60)."""
    query = f"""
        SELECT COUNTIF(
            start_lat < 24 OR start_lat > 72
            OR start_lng < -180 OR start_lng > -60
        ) AS out_of_bounds
        FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
    """
    row = next(iter(bq_client.query(query).result()))
    assert row.out_of_bounds == 0, (
        f"{row.out_of_bounds} accident points outside US bounding box"
    )


# ---------------------------------------------------------------------------
# VAL-03: Join coverage
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_join_coverage_boundaries(bq_client):
    """>=90% of distinct accident zips match zipcode_boundaries."""
    query = f"""
        WITH accident_zips AS (
            SELECT DISTINCT zipcode AS zip FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
            WHERE zipcode IS NOT NULL
        ),
        matched AS (
            SELECT a.zip
            FROM accident_zips a
            INNER JOIN `{PROJECT_ID}.{DATASET_ID}.zipcode_boundaries` b
                ON a.zip = b.zip_code
        )
        SELECT
            (SELECT COUNT(*) FROM accident_zips) AS total,
            (SELECT COUNT(*) FROM matched) AS matched
    """
    row = next(iter(bq_client.query(query).result()))
    coverage = row.matched / row.total if row.total > 0 else 0
    assert coverage >= 0.90, (
        f"Boundary join coverage {coverage:.2%} < 90% "
        f"({row.matched}/{row.total})"
    )


@pytest.mark.integration
def test_join_coverage_reference(bq_client):
    """>=90% of distinct accident zips match zip_reference."""
    query = f"""
        WITH accident_zips AS (
            SELECT DISTINCT zipcode AS zip FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
            WHERE zipcode IS NOT NULL
        ),
        matched AS (
            SELECT a.zip
            FROM accident_zips a
            INNER JOIN `{PROJECT_ID}.{DATASET_ID}.zip_reference` r
                ON a.zip = r.zip_code
        )
        SELECT
            (SELECT COUNT(*) FROM accident_zips) AS total,
            (SELECT COUNT(*) FROM matched) AS matched
    """
    row = next(iter(bq_client.query(query).result()))
    coverage = row.matched / row.total if row.total > 0 else 0
    assert coverage >= 0.90, (
        f"Reference join coverage {coverage:.2%} < 90% "
        f"({row.matched}/{row.total})"
    )


# ---------------------------------------------------------------------------
# Cross-check: density table populated
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_density_table_populated(bq_client):
    """accident_density table has > 0 rows."""
    table = bq_client.get_table(f"{PROJECT_ID}.{DATASET_ID}.accident_density")
    assert table.num_rows > 0, "accident_density table is empty"


# ---------------------------------------------------------------------------
# Views exist and are queryable
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_views_exist(bq_client):
    """All 3 views are queryable without error."""
    views = [
        "v_market_opportunity",
        "v_shop_coverage",
        "v_accident_trends_by_zip",
    ]
    for view in views:
        query = f"SELECT * FROM `{PROJECT_ID}.{DATASET_ID}.{view}` LIMIT 1"
        rows = list(bq_client.query(query).result())
        assert isinstance(rows, list), f"{view} query failed"
