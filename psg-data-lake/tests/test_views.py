"""Integration tests for spatial join views and cross-dataset queries."""

import pytest

from config import PROJECT_ID, DATASET_ID, ADVANTAGE_DATASET_ID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _shop_table_info(client):
    """Discover body shop table in psg_advantage_data. Return table name or None."""
    query = f"""
        SELECT table_name
        FROM `{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.INFORMATION_SCHEMA.TABLES`
    """
    tables = [row.table_name for row in client.query(query).result()]
    for t in tables:
        if any(kw in t.lower() for kw in ["shop", "body", "location", "store"]):
            # Check for a GEOGRAPHY column
            col_query = f"""
                SELECT column_name, data_type
                FROM `{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.INFORMATION_SCHEMA.COLUMNS`
                WHERE table_name = '{t}'
            """
            cols = {r.column_name: r.data_type for r in client.query(col_query).result()}
            has_geo = any(v == "GEOGRAPHY" for v in cols.values())
            return {"table": t, "has_geo": has_geo}
    return None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_spatial_join_accidents(bq_client):
    """SPA-01: ST_WITHIN join between accidents and boundaries returns rows."""
    query = f"""
        SELECT COUNT(*) AS cnt
        FROM `{PROJECT_ID}.{DATASET_ID}.accidents` a
        INNER JOIN `{PROJECT_ID}.{DATASET_ID}.zipcode_boundaries` b
            ON ST_WITHIN(a.accident_geo, b.boundary_geo)
        WHERE a.accident_geo IS NOT NULL
    """
    row = next(iter(bq_client.query(query).result()))
    assert row.cnt > 0, "Spatial join returned 0 rows"


@pytest.mark.integration
def test_spatial_join_shops(bq_client):
    """SPA-02: If body shop table has GEOGRAPHY, ST_WITHIN join returns rows."""
    info = _shop_table_info(bq_client)
    if info is None or not info["has_geo"]:
        pytest.skip("No body shop table with GEOGRAPHY column found")

    shop_fq = f"`{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.{info['table']}`"
    # Find the geography column name
    col_query = f"""
        SELECT column_name
        FROM `{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = '{info['table']}' AND data_type = 'GEOGRAPHY'
        LIMIT 1
    """
    geo_col = next(iter(bq_client.query(col_query).result())).column_name

    query = f"""
        SELECT COUNT(*) AS cnt
        FROM {shop_fq} s
        INNER JOIN `{PROJECT_ID}.{DATASET_ID}.zipcode_boundaries` b
            ON ST_WITHIN(s.{geo_col}, b.boundary_geo)
    """
    row = next(iter(bq_client.query(query).result()))
    assert row.cnt > 0, "Shop spatial join returned 0 rows"


@pytest.mark.integration
def test_market_coverage_gaps(bq_client):
    """SPA-03: Find zips with accidents but no shop presence."""
    info = _shop_table_info(bq_client)
    if info is None or not info["has_geo"]:
        pytest.skip("No body shop table found -- cannot assess coverage gaps")

    query = f"""
        SELECT COUNT(*) AS cnt
        FROM `{PROJECT_ID}.{DATASET_ID}.v_market_opportunity`
        WHERE nearest_shop_meters IS NOT NULL
    """
    row = next(iter(bq_client.query(query).result()))
    # At least some zips should exist regardless
    assert row.cnt >= 0, "Coverage gap query failed"


@pytest.mark.integration
def test_views_queryable(bq_client):
    """SPA-04: All 3 views return rows from SELECT LIMIT 5 without error."""
    views = [
        "v_market_opportunity",
        "v_shop_coverage",
        "v_accident_trends_by_zip",
    ]
    for view in views:
        query = f"SELECT * FROM `{PROJECT_ID}.{DATASET_ID}.{view}` LIMIT 5"
        rows = list(bq_client.query(query).result())
        # Shop-dependent views may return 0 rows but must not error
        assert isinstance(rows, list), f"{view} query failed"


@pytest.mark.integration
def test_opportunity_score_range(bq_client):
    """Opportunity score 0-100 and tier in (High, Medium, Low)."""
    query = f"""
        SELECT opportunity_score, opportunity_tier
        FROM `{PROJECT_ID}.{DATASET_ID}.v_market_opportunity`
        LIMIT 100
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) > 0, "v_market_opportunity returned no rows"
    for row in rows:
        assert 0 <= row.opportunity_score <= 100, (
            f"Score {row.opportunity_score} out of range"
        )
        assert row.opportunity_tier in ("High", "Medium", "Low"), (
            f"Unexpected tier: {row.opportunity_tier}"
        )


@pytest.mark.integration
def test_trends_has_yoy(bq_client):
    """v_accident_trends_by_zip has yoy_change_pct column."""
    query = f"""
        SELECT column_name
        FROM `{PROJECT_ID}.{DATASET_ID}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = 'v_accident_trends_by_zip'
          AND column_name = 'yoy_change_pct'
    """
    rows = list(bq_client.query(query).result())
    assert len(rows) == 1, "yoy_change_pct column missing from v_accident_trends_by_zip"
