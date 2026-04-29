#!/usr/bin/env python3
"""Create cross-dataset analytical views in BigQuery.

Creates three views connecting accidents, zip boundaries, and body shop data:
- v_market_opportunity: weighted opportunity score per zip
- v_shop_coverage: shop-centric 10-mile radius metrics
- v_accident_trends_by_zip: yearly counts with YoY change

Discovers body shop table at runtime from psg_advantage_data.
If no shop table found, creates simplified views without shop metrics.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import get_client
from config import PROJECT_ID, DATASET_ID, ADVANTAGE_DATASET_ID


# ---------------------------------------------------------------------------
# Body shop discovery
# ---------------------------------------------------------------------------

def discover_shop_table(client):
    """Discover body shop table in psg_advantage_data.

    Returns dict with table_fq (fully qualified), geo_col, or None if missing.
    If lat/lng exist but no GEOGRAPHY column, adds one via ALTER TABLE + UPDATE.
    """
    tables_query = f"""
        SELECT table_name
        FROM `{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.INFORMATION_SCHEMA.TABLES`
    """
    tables = [row.table_name for row in client.query(tables_query).result()]

    shop_table = None
    for t in tables:
        if any(kw in t.lower() for kw in ["shop", "body", "location", "store"]):
            shop_table = t
            break

    if shop_table is None:
        print("WARNING: No body shop table found in psg_advantage_data. "
              "Skipping shop-dependent features.")
        return None

    print(f"Found body shop table: {ADVANTAGE_DATASET_ID}.{shop_table}")

    # Discover columns
    cols_query = f"""
        SELECT column_name, data_type
        FROM `{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.INFORMATION_SCHEMA.COLUMNS`
        WHERE table_name = '{shop_table}'
    """
    columns = {row.column_name: row.data_type
               for row in client.query(cols_query).result()}

    # Check for existing GEOGRAPHY column
    geo_col = None
    for col_name, col_type in columns.items():
        if col_type == "GEOGRAPHY":
            geo_col = col_name
            break

    if geo_col:
        print(f"  GEOGRAPHY column found: {geo_col}")
        return {
            "table_fq": f"`{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.{shop_table}`",
            "geo_col": geo_col,
        }

    # Check for lat/lng columns
    lat_col = next((c for c in columns if "lat" in c.lower()), None)
    lng_col = next(
        (c for c in columns if "lng" in c.lower() or "lon" in c.lower()), None
    )

    if lat_col and lng_col:
        print(f"  Found lat/lng columns: {lat_col}, {lng_col}")
        print("  Adding GEOGRAPHY column shop_geo...")

        table_fq = f"`{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.{shop_table}`"

        alter_sql = f"""
            ALTER TABLE {table_fq}
            ADD COLUMN IF NOT EXISTS shop_geo GEOGRAPHY
        """
        client.query(alter_sql).result()

        update_sql = f"""
            UPDATE {table_fq}
            SET shop_geo = ST_GEOGPOINT({lng_col}, {lat_col})
            WHERE {lat_col} IS NOT NULL AND {lng_col} IS NOT NULL
        """
        client.query(update_sql).result()
        print("  GEOGRAPHY column added and populated.")

        return {"table_fq": table_fq, "geo_col": "shop_geo"}

    print(f"  WARNING: No GEOGRAPHY or lat/lng columns in {shop_table}. "
          "Skipping shop-dependent features.")
    return None


# ---------------------------------------------------------------------------
# View: v_market_opportunity
# ---------------------------------------------------------------------------

def create_v_market_opportunity(client, shop_info):
    """Create v_market_opportunity view with weighted opportunity score.

    If shop_info is provided, includes nearest-shop distance factor.
    Otherwise uses simplified scoring (volume 70%, severity 30%).
    """
    if shop_info:
        # Full version with shop distance as tertiary factor
        shop_cte = f"""
        nearest_shop AS (
            SELECT
                b.zip_code,
                MIN(ST_DISTANCE(ST_CENTROID(b.boundary_geo), s.{shop_info['geo_col']})) AS nearest_shop_meters
            FROM `{PROJECT_ID}.{DATASET_ID}.zipcode_boundaries` b
            CROSS JOIN {shop_info['table_fq']} s
            WHERE s.{shop_info['geo_col']} IS NOT NULL
            GROUP BY b.zip_code
        ),
        """
        nearest_join = """
            LEFT JOIN nearest_shop ns ON d.zip = ns.zip_code
        """
        nearest_col = "ns.nearest_shop_meters"
        score_expr = """
            ROUND(
                PERCENT_RANK() OVER (ORDER BY total_accidents) * 50
                + PERCENT_RANK() OVER (ORDER BY high_severity_pct) * 30
                + PERCENT_RANK() OVER (ORDER BY nearest_shop_meters DESC NULLS LAST) * 20
            , 1) AS opportunity_score
        """
    else:
        # Simplified version without shop data
        shop_cte = ""
        nearest_join = ""
        nearest_col = "CAST(NULL AS FLOAT64) AS nearest_shop_meters"
        score_expr = """
            ROUND(
                PERCENT_RANK() OVER (ORDER BY total_accidents) * 70
                + PERCENT_RANK() OVER (ORDER BY high_severity_pct) * 30
            , 1) AS opportunity_score
        """

    view_sql = f"""
    CREATE OR REPLACE VIEW `{PROJECT_ID}.{DATASET_ID}.v_market_opportunity` AS
    WITH
    {shop_cte}
    base AS (
        SELECT
            d.zip,
            d.state,
            SUM(d.total_count) AS total_accidents,
            SUM(d.severity_3_count + d.severity_4_count) AS high_severity_count,
            SAFE_DIVIDE(
                SUM(d.severity_3_count + d.severity_4_count),
                SUM(d.total_count)
            ) AS high_severity_pct,
            {nearest_col}
        FROM `{PROJECT_ID}.{DATASET_ID}.accident_density` d
        {nearest_join}
        GROUP BY d.zip, d.state{', ns.nearest_shop_meters' if shop_info else ''}
    ),
    scored AS (
        SELECT
            zip,
            state,
            total_accidents,
            high_severity_count,
            high_severity_pct,
            nearest_shop_meters,
            {score_expr}
        FROM base
    )
    SELECT
        zip,
        state,
        total_accidents,
        high_severity_count,
        high_severity_pct,
        nearest_shop_meters,
        opportunity_score,
        CASE
            WHEN opportunity_score >= 75 THEN 'High'
            WHEN opportunity_score >= 40 THEN 'Medium'
            ELSE 'Low'
        END AS opportunity_tier
    FROM scored
    """
    client.query(view_sql).result()
    print("Created view: v_market_opportunity")


# ---------------------------------------------------------------------------
# View: v_shop_coverage
# ---------------------------------------------------------------------------

def create_v_shop_coverage(client, shop_info):
    """Create v_shop_coverage view showing 10-mile radius metrics per shop.

    If no shop table, creates empty placeholder view with correct schema.
    """
    if shop_info is None:
        # Placeholder view with correct columns but no rows
        view_sql = f"""
        CREATE OR REPLACE VIEW `{PROJECT_ID}.{DATASET_ID}.v_shop_coverage` AS
        -- Placeholder: no body shop table found in {ADVANTAGE_DATASET_ID}
        SELECT
            CAST(NULL AS STRING) AS shop_id,
            CAST(NULL AS STRING) AS shop_name,
            CAST(NULL AS INT64) AS accidents_within_10mi,
            CAST(NULL AS INT64) AS competing_shops_within_10mi
        FROM UNNEST([]) AS empty
        """
    else:
        # Discover a name/id column for shops
        cols_query = f"""
            SELECT column_name
            FROM `{PROJECT_ID}.{ADVANTAGE_DATASET_ID}.INFORMATION_SCHEMA.COLUMNS`
            WHERE table_name = '{shop_info["table_fq"].split(".")[-1].strip("`")}'
        """
        col_names = [r.column_name for r in client.query(cols_query).result()]

        # Pick identifier columns
        id_col = next(
            (c for c in col_names if "id" in c.lower()),
            col_names[0] if col_names else "GENERATE_UUID()"
        )
        name_col = next(
            (c for c in col_names if "name" in c.lower()),
            id_col
        )
        geo_col = shop_info["geo_col"]

        view_sql = f"""
        CREATE OR REPLACE VIEW `{PROJECT_ID}.{DATASET_ID}.v_shop_coverage` AS
        WITH accident_counts AS (
            SELECT
                s.{id_col} AS shop_id,
                COUNT(*) AS accidents_within_10mi
            FROM {shop_info['table_fq']} s
            INNER JOIN `{PROJECT_ID}.{DATASET_ID}.accidents` a
                ON ST_DWITHIN(s.{geo_col}, a.accident_geo, 16093.4)
            WHERE s.{geo_col} IS NOT NULL AND a.accident_geo IS NOT NULL
            GROUP BY s.{id_col}
        ),
        competitor_counts AS (
            SELECT
                s1.{id_col} AS shop_id,
                COUNT(DISTINCT s2.{id_col}) AS competing_shops_within_10mi
            FROM {shop_info['table_fq']} s1
            LEFT JOIN {shop_info['table_fq']} s2
                ON ST_DWITHIN(s1.{geo_col}, s2.{geo_col}, 16093.4)
                AND s1.{id_col} != s2.{id_col}
            WHERE s1.{geo_col} IS NOT NULL
            GROUP BY s1.{id_col}
        )
        SELECT
            s.{id_col} AS shop_id,
            s.{name_col} AS shop_name,
            COALESCE(ac.accidents_within_10mi, 0) AS accidents_within_10mi,
            COALESCE(cc.competing_shops_within_10mi, 0) AS competing_shops_within_10mi
        FROM {shop_info['table_fq']} s
        LEFT JOIN accident_counts ac ON s.{id_col} = ac.shop_id
        LEFT JOIN competitor_counts cc ON s.{id_col} = cc.shop_id
        WHERE s.{geo_col} IS NOT NULL
        """

    client.query(view_sql).result()
    print("Created view: v_shop_coverage")


# ---------------------------------------------------------------------------
# View: v_accident_trends_by_zip
# ---------------------------------------------------------------------------

def create_v_accident_trends_by_zip(client):
    """Create v_accident_trends_by_zip view with yearly counts and YoY change."""
    view_sql = f"""
    CREATE OR REPLACE VIEW `{PROJECT_ID}.{DATASET_ID}.v_accident_trends_by_zip` AS
    WITH yearly AS (
        SELECT
            zipcode AS zip,
            state,
            EXTRACT(YEAR FROM start_time) AS year,
            COUNT(*) AS accident_count,
            COUNTIF(severity >= 3) AS high_severity_count,
            ROUND(AVG(severity), 2) AS avg_severity
        FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
        WHERE zipcode IS NOT NULL AND start_time IS NOT NULL
        GROUP BY zipcode, state, EXTRACT(YEAR FROM start_time)
    )
    SELECT
        zip,
        state,
        year,
        accident_count,
        high_severity_count,
        avg_severity,
        LAG(accident_count) OVER (PARTITION BY zip ORDER BY year) AS prev_year_count,
        SAFE_DIVIDE(
            accident_count - LAG(accident_count) OVER (PARTITION BY zip ORDER BY year),
            LAG(accident_count) OVER (PARTITION BY zip ORDER BY year)
        ) AS yoy_change_pct
    FROM yearly
    """
    client.query(view_sql).result()
    print("Created view: v_accident_trends_by_zip")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    """Discover shop table, create all 3 views."""
    client = get_client()

    print("=== Discovering body shop table ===")
    shop_info = discover_shop_table(client)

    print("\n=== Creating views ===")
    create_v_market_opportunity(client, shop_info)
    create_v_shop_coverage(client, shop_info)
    create_v_accident_trends_by_zip(client)

    print("\n=== All views created successfully ===")


if __name__ == "__main__":
    main()
