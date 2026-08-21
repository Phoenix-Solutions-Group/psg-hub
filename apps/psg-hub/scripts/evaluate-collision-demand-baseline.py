#!/usr/bin/env python3
"""Evaluate leakage-safe weekly repair-demand baselines from Supabase CLI JSON."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date
from pathlib import Path
from typing import Any


def parse_rows(raw: str) -> list[dict[str, Any]]:
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Input does not contain a Supabase JSON result")
    payload = json.loads(raw[start : end + 1])
    rows = payload.get("rows")
    if not isinstance(rows, list):
        raise ValueError("Supabase JSON result does not contain a rows array")
    return sorted(rows, key=lambda row: row["week_start"])


def error_metrics(actual: list[float], predicted: list[float]) -> dict[str, float]:
    if not actual or len(actual) != len(predicted):
        raise ValueError("Actual and predicted values must have equal non-zero length")
    errors = [prediction - observation for observation, prediction in zip(actual, predicted)]
    return {
        "mae": sum(abs(error) for error in errors) / len(errors),
        "rmse": math.sqrt(sum(error * error for error in errors) / len(errors)),
        "wape_pct": 100 * sum(abs(error) for error in errors) / max(sum(actual), 1),
    }


def evaluate(rows: list[dict[str, Any]], holdout_weeks: int) -> dict[str, Any]:
    eligible = [
        row
        for row in rows
        if row.get("repair_orders_lag_52_weeks") is not None
        and row.get("trailing_4_week_average") is not None
    ]
    if len(eligible) < holdout_weeks:
        raise ValueError(
            f"Need at least {holdout_weeks} eligible weeks; received {len(eligible)}"
        )

    holdout = eligible[-holdout_weeks:]
    actual = [float(row["repair_orders"]) for row in holdout]
    predictions = {
        "seasonal_52_week": [float(row["repair_orders_lag_52_weeks"]) for row in holdout],
        "trailing_4_week": [float(row["trailing_4_week_average"]) for row in holdout],
        "seasonal_recent_blend": [
            (float(row["repair_orders_lag_52_weeks"]) + float(row["trailing_4_week_average"])) / 2
            for row in holdout
        ],
    }
    models = {name: error_metrics(actual, values) for name, values in predictions.items()}
    champion = min(models, key=lambda name: models[name]["mae"])
    seasonal_mae = models["seasonal_52_week"]["mae"]
    champion_mae = models[champion]["mae"]

    return {
        "training_start": rows[0]["week_start"],
        "training_end": rows[-1]["week_start"],
        "holdout_start": holdout[0]["week_start"],
        "holdout_end": holdout[-1]["week_start"],
        "holdout_weeks": holdout_weeks,
        "holdout_repairs": int(sum(actual)),
        "models": models,
        "champion": champion,
        "beats_seasonal": champion != "seasonal_52_week" and champion_mae < seasonal_mae,
        "mae_improvement_pct": 100 * (seasonal_mae - champion_mae) / seasonal_mae
        if seasonal_mae
        else 0,
    }


def print_markdown(result: dict[str, Any]) -> None:
    print("# Weekly Repair-Demand Baseline")
    print()
    print(
        f"Training frame: {result['training_start']} through {result['training_end']}; "
        f"chronological holdout: {result['holdout_start']} through {result['holdout_end']} "
        f"({result['holdout_weeks']} weeks, {result['holdout_repairs']} repairs)."
    )
    print()
    print("| Model | MAE | RMSE | WAPE |")
    print("|---|---:|---:|---:|")
    for name, metrics in result["models"].items():
        print(
            f"| {name} | {metrics['mae']:.2f} | {metrics['rmse']:.2f} | "
            f"{metrics['wape_pct']:.1f}% |"
        )
    print()
    outcome = "beats" if result["beats_seasonal"] else "does not beat"
    print(
        f"Champion: **{result['champion']}**; it {outcome} the registered 52-week "
        f"seasonal baseline by {result['mae_improvement_pct']:.1f}% MAE."
    )
    print(
        "Scope: one pilot company. This is a repair-arrival baseline, not a crash or "
        "insurance-claim forecast."
    )


def self_test() -> None:
    actual = [10.0, 12.0]
    metrics = error_metrics(actual, [9.0, 14.0])
    assert round(metrics["mae"], 4) == 1.5
    assert round(metrics["rmse"], 4) == round(math.sqrt(2.5), 4)
    assert round(metrics["wape_pct"], 4) == round(300 / 22, 4)
    assert date.fromisoformat("2025-01-06").weekday() == 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", help="Supabase CLI JSON file; defaults to stdin")
    parser.add_argument("--holdout-weeks", type=int, default=52)
    parser.add_argument("--json", action="store_true", help="Print machine-readable output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        print("ok")
        return

    raw = Path(args.path).read_text(encoding="utf-8") if args.path else sys.stdin.read()
    result = evaluate(parse_rows(raw), args.holdout_weeks)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print_markdown(result)


if __name__ == "__main__":
    main()
