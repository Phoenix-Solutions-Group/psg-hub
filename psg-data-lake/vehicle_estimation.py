#!/usr/bin/env python3
"""Estimate ZIP-level total vehicle counts from Census + FHWA data.

Core model: ACS5 B25046 household vehicles per ZCTA, raked to FHWA MV-1 state
totals, with ground-truth overrides from CA/NY ZIP data and TX/MD/WA county
data disaggregated via HUD crosswalk.

Output table: estimated_zip_vehicles.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from typing import Any

from supabase_migration import connect


US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
    "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
    "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
    "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
    "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
}

REGIONS = {
    "northeast": {"NY", "NJ", "CT", "MA", "PA", "ME", "VT", "NH", "RI"},
    "southeast": {"FL", "GA", "NC", "SC", "VA", "MD", "DC"},
    "midwest": {"IL", "OH", "MI", "IN", "WI", "MN", "MO"},
    "west": {"CA", "WA", "OR", "CO", "AZ", "NV"},
    "south_central": {"TX", "LA", "OK", "AR", "TN", "KY"},
}

GROUND_TRUTH_ZIP_STATES = {"CA", "NY"}

COUNTY_DISAGG_STATES = {"TX", "MD", "WA"}

ESTIMATE_COPY_COLUMNS = [
    "zip",
    "state",
    "year",
    "household_vehicles",
    "adjustment_factor",
    "estimated_total_vehicles",
    "data_quality_flag",
    "source_mix",
    "import_batch_id",
]


def _load_fhwa_state_totals(conn, year: int) -> dict[str, int]:
    """Load FHWA MV-1 state totals for the closest available year."""
    rows = conn.execute(
        """
        SELECT state,
               COALESCE(auto_count, 0) + COALESCE(bus_count, 0)
               + COALESCE(truck_count, 0) + COALESCE(motorcycle_count, 0) AS total
        FROM state_vehicle_registrations
        WHERE year = (
            SELECT MAX(year) FROM state_vehicle_registrations WHERE year <= %s
        )
        """,
        (year,),
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def _load_acs_zcta_vehicles(conn, year: int) -> list[dict[str, Any]]:
    """Load Census B25046 aggregate vehicles per ZCTA with state mapping."""
    rows = conn.execute(
        """
        SELECT v.zcta, v.aggregate_vehicles, v.aggregate_vehicles_moe,
               zm.state_abbr
        FROM zcta_vehicle_availability v
        JOIN zcta_zip_mapping zm ON zm.zcta = v.zcta
        WHERE v.year = %s
          AND v.aggregate_vehicles IS NOT NULL
          AND v.aggregate_vehicles > 0
          AND zm.state_abbr IS NOT NULL
        """,
        (year,),
    ).fetchall()
    seen: dict[str, dict[str, Any]] = {}
    for row in rows:
        zcta = row[0]
        if zcta not in seen:
            seen[zcta] = {
                "zcta": zcta,
                "aggregate_vehicles": row[1],
                "moe": row[2],
                "state": row[3],
            }
    return list(seen.values())


def _load_ground_truth_zip(conn, state: str) -> dict[str, int]:
    """Load actual ZIP-level vehicle counts for ground-truth states."""
    source_key = "ca_dmv" if state == "CA" else "ny_dmv"
    rows = conn.execute(
        """
        SELECT dvr.zip, dvr.vehicle_count
        FROM dmv_vehicle_registrations dvr
        WHERE dvr.source = %s
          AND dvr.vehicle_count > 0
          AND dvr.snapshot_date = (
              SELECT MAX(snapshot_date) FROM dmv_vehicle_registrations
              WHERE source = %s
          )
        """,
        (source_key, source_key),
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def _compute_adjustment_factors(
    zcta_data: list[dict[str, Any]],
    fhwa_totals: dict[str, int],
) -> dict[str, float]:
    """Compute per-state adjustment factor = FHWA total / sum(ACS ZCTAs)."""
    state_acs: dict[str, int] = {}
    for row in zcta_data:
        st = row["state"]
        if st:
            state_acs[st] = state_acs.get(st, 0) + row["aggregate_vehicles"]

    factors: dict[str, float] = {}
    for state, acs_total in state_acs.items():
        fhwa_total = fhwa_totals.get(state)
        if fhwa_total and acs_total > 0:
            factors[state] = fhwa_total / acs_total
        else:
            factors[state] = 1.0
    return factors


def estimate_vehicles(
    conn,
    *,
    year: int = 2023,
    states: set[str] | None = None,
) -> dict[str, Any]:
    batch_id = f"vehicle_estimate-{year}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"
    target_states = states or US_STATES

    fhwa_totals = _load_fhwa_state_totals(conn, year)
    zcta_data = _load_acs_zcta_vehicles(conn, year)
    if states:
        zcta_data = [r for r in zcta_data if r["state"] in target_states]

    adjustment_factors = _compute_adjustment_factors(zcta_data, fhwa_totals)

    ground_truth: dict[str, dict[str, int]] = {}
    for gt_state in GROUND_TRUTH_ZIP_STATES & target_states:
        gt_data = _load_ground_truth_zip(conn, gt_state)
        if gt_data:
            ground_truth[gt_state] = gt_data

    estimates: list[dict[str, Any]] = []
    for row in zcta_data:
        st = row["state"]
        if not st or st not in target_states:
            continue

        zcta = row["zcta"]
        hh_vehicles = row["aggregate_vehicles"]
        factor = adjustment_factors.get(st, 1.0)

        if st in ground_truth and zcta in ground_truth[st]:
            estimated = ground_truth[st][zcta]
            flag = "ground_truth"
            source_mix = f"dmv_{st.lower()}"
        else:
            estimated = round(hh_vehicles * factor)
            flag = "model_estimate"
            source_mix = f"acs5_b25046+fhwa_mv1 (factor={factor:.3f})"

        estimates.append({
            "zip": zcta,
            "state": st,
            "year": year,
            "household_vehicles": hh_vehicles,
            "adjustment_factor": round(factor, 4),
            "estimated_total_vehicles": estimated,
            "data_quality_flag": flag,
            "source_mix": source_mix,
            "import_batch_id": batch_id,
        })

    if not estimates:
        return {"rows_estimated": 0, "import_batch_id": batch_id}

    conn.execute(
        "CREATE TEMP TABLE est_zip_stage"
        " (LIKE public.estimated_zip_vehicles INCLUDING DEFAULTS)"
        " ON COMMIT DROP"
    )
    with conn.cursor() as cur:
        with cur.copy(
            f"COPY est_zip_stage ({', '.join(ESTIMATE_COPY_COLUMNS)}) FROM STDIN"
        ) as copy:
            for record in estimates:
                copy.write_row([record[col] for col in ESTIMATE_COPY_COLUMNS])

    state_filter = ""
    params: tuple = ()
    if states:
        placeholders = ", ".join(["%s"] * len(states))
        state_filter = f"AND state IN ({placeholders})"
        params = tuple(sorted(states))

    conn.execute(
        f"DELETE FROM public.estimated_zip_vehicles WHERE year = %s {state_filter}",
        (year, *params),
    )

    columns = ", ".join(ESTIMATE_COPY_COLUMNS)
    conn.execute(
        f"""
        INSERT INTO public.estimated_zip_vehicles ({columns})
        SELECT {columns} FROM est_zip_stage
        """
    )
    conn.commit()

    gt_count = sum(1 for e in estimates if e["data_quality_flag"] == "ground_truth")
    model_count = sum(1 for e in estimates if e["data_quality_flag"] == "model_estimate")

    state_factors = {
        st: round(f, 3) for st, f in sorted(adjustment_factors.items()) if st in target_states
    }

    return {
        "import_batch_id": batch_id,
        "year": year,
        "rows_estimated": len(estimates),
        "ground_truth_zips": gt_count,
        "model_estimate_zips": model_count,
        "states_covered": len(state_factors),
        "adjustment_factors": state_factors,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL"),
        help="Direct Postgres connection string for Supabase",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    est = subcommands.add_parser("estimate")
    est.add_argument("--year", type=int, default=2023)
    est.add_argument("--state", default=None, help="Single state abbreviation")
    est.add_argument(
        "--region",
        default=None,
        choices=sorted(REGIONS),
        help="Region name",
    )

    subcommands.add_parser("national")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.database_url:
        parser.error("--database-url or SUPABASE_DB_URL is required")

    with connect(args.database_url) as conn:
        if args.command == "national":
            result = estimate_vehicles(conn)
        elif args.command == "estimate":
            target_states: set[str] | None = None
            if args.state:
                target_states = {args.state.upper()}
            elif args.region:
                target_states = REGIONS[args.region]
            result = estimate_vehicles(
                conn, year=args.year, states=target_states
            )
        else:
            parser.error(f"Unknown command: {args.command}")
            return 1
        print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
