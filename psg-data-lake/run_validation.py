#!/usr/bin/env python3
"""Data lake validation report.

Runs row-count, geographic-bounds, join-coverage, and null-geography checks
against psg_geo_data tables. Prints a readable console report and exits 0
if all checks pass, 1 if any fail.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import get_client
from config import PROJECT_ID, DATASET_ID


# ---------------------------------------------------------------------------
# Expected row count ranges
# ---------------------------------------------------------------------------

EXPECTED_RANGES = {
    "accidents": (7_700_000, 7_800_000),
    "zipcode_boundaries": (33_000, 34_000),
    "zip_reference": (33_000, 34_000),
    "state_reference": (50, 60),
    "county_reference": (3_000, 3_500),
    "zcta_zip_mapping": (40_000, 42_000),
    "accident_density": (1, None),
}


# ---------------------------------------------------------------------------
# Check functions
# ---------------------------------------------------------------------------

def check_row_counts(client):
    """Query num_rows for each table and compare to expected ranges.

    Returns list of (table, count, passed) tuples and overall pass boolean.
    """
    results = []
    print(f"{'Table':<25} {'Row Count':>12} {'Expected':>20} {'Status':>8}")
    print("-" * 70)

    for table_name, (lo, hi) in EXPECTED_RANGES.items():
        table_ref = f"{PROJECT_ID}.{DATASET_ID}.{table_name}"
        table = client.get_table(table_ref)
        count = table.num_rows

        if hi is None:
            expected_str = f">= {lo:,}"
            passed = count >= lo
        else:
            expected_str = f"{lo:,} - {hi:,}"
            passed = lo <= count <= hi

        status = "PASS" if passed else "FAIL"
        print(f"{table_name:<25} {count:>12,} {expected_str:>20} {status:>8}")
        results.append((table_name, count, passed))

    all_passed = all(p for _, _, p in results)
    return results, all_passed


def check_geographic_bounds(client):
    """Count accident points outside US bounding box.

    Threshold: 0 out-of-bounds points.
    Returns (total, out_of_bounds, passed).
    """
    query = f"""
        SELECT
            COUNT(*) AS total,
            COUNTIF(
                start_lat < 24 OR start_lat > 72
                OR start_lng < -180 OR start_lng > -60
            ) AS out_of_bounds
        FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
    """
    row = next(iter(client.query(query).result()))
    passed = row.out_of_bounds == 0
    status = "PASS" if passed else "FAIL"

    print(f"Total accident points:  {row.total:,}")
    print(f"Out-of-bounds points:   {row.out_of_bounds:,}")
    print(f"Status:                 {status}")

    return row.total, row.out_of_bounds, passed


def check_join_coverage(client):
    """Compute join coverage between accident zips and boundary/reference tables.

    Threshold: >= 90% for both.
    Returns list of (join_name, total, matched, pct, passed).
    """
    joins = [
        ("zipcode_boundaries", "zip_code"),
        ("zip_reference", "zip_code"),
    ]

    results = []
    for join_table, join_col in joins:
        query = f"""
            WITH accident_zips AS (
                SELECT DISTINCT zipcode AS zip
                FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
                WHERE zipcode IS NOT NULL
            ),
            matched AS (
                SELECT a.zip
                FROM accident_zips a
                INNER JOIN `{PROJECT_ID}.{DATASET_ID}.{join_table}` b
                    ON a.zip = b.{join_col}
            )
            SELECT
                (SELECT COUNT(*) FROM accident_zips) AS total,
                (SELECT COUNT(*) FROM matched) AS matched
        """
        row = next(iter(client.query(query).result()))
        pct = row.matched / row.total if row.total > 0 else 0
        passed = pct >= 0.90
        status = "PASS" if passed else "FAIL"

        print(f"{join_table}:")
        print(f"  Distinct accident zips: {row.total:,}")
        print(f"  Matched:               {row.matched:,} ({pct:.1%})")
        print(f"  Status:                {status}")

        results.append((join_table, row.total, row.matched, pct, passed))

    all_passed = all(p for _, _, _, _, p in results)
    return results, all_passed


def check_null_geography(client):
    """Count NULL accident_geo values. Informational only (not a pass/fail gate)."""
    query = f"""
        SELECT
            COUNT(*) AS total,
            COUNTIF(accident_geo IS NULL) AS null_geo
        FROM `{PROJECT_ID}.{DATASET_ID}.accidents`
    """
    row = next(iter(client.query(query).result()))
    pct = row.null_geo / row.total if row.total > 0 else 0

    print(f"Total accident rows:     {row.total:,}")
    print(f"NULL accident_geo:       {row.null_geo:,} ({pct:.1%})")
    print(f"(Informational -- not a pass/fail gate)")

    return row.total, row.null_geo


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    client = get_client()
    checks_passed = 0
    checks_total = 0

    print("=" * 70)
    print("PSG DATA LAKE VALIDATION REPORT")
    print("=" * 70)

    # 1. Row counts
    print("\n--- Row Counts (VAL-01) ---\n")
    _, rc_passed = check_row_counts(client)
    checks_total += 1
    if rc_passed:
        checks_passed += 1

    # 2. Geographic bounds
    print("\n--- Geographic Bounds (VAL-02) ---\n")
    _, _, gb_passed = check_geographic_bounds(client)
    checks_total += 1
    if gb_passed:
        checks_passed += 1

    # 3. Join coverage
    print("\n--- Join Coverage (VAL-03) ---\n")
    _, jc_passed = check_join_coverage(client)
    checks_total += 1
    if jc_passed:
        checks_passed += 1

    # 4. Null geography (informational)
    print("\n--- NULL Geography (informational) ---\n")
    check_null_geography(client)

    # Summary
    print("\n" + "=" * 70)
    print(f"VALIDATION SUMMARY: {checks_passed}/{checks_total} checks passed")
    if checks_passed == checks_total:
        print("STATUS: ALL CHECKS PASSED")
    else:
        print("STATUS: SOME CHECKS FAILED")
    print("=" * 70)

    return 0 if checks_passed == checks_total else 1


if __name__ == "__main__":
    sys.exit(main())
