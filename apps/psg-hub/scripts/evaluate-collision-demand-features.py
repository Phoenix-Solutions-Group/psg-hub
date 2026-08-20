#!/usr/bin/env python3
"""Test whether lagged crash/weather features improve weekly repair forecasts."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable


FEATURE_SETS = {
    "ridge_demand": ("trailing_4_week_average", "repair_orders_lag_52_weeks"),
    "ridge_demand_crash": (
        "trailing_4_week_average",
        "repair_orders_lag_52_weeks",
        "prior_month_crashes",
        "prior_month_rain_or_snow_crashes",
    ),
    "ridge_demand_weather": (
        "trailing_4_week_average",
        "repair_orders_lag_52_weeks",
        "prior_month_weighted_storm_demand_score",
    ),
    "ridge_all": (
        "trailing_4_week_average",
        "repair_orders_lag_52_weeks",
        "prior_month_crashes",
        "prior_month_rain_or_snow_crashes",
        "prior_month_weighted_storm_demand_score",
    ),
}

MAX_INTERNAL_ZERO_WEEKS = 26
INTERVAL_CALIBRATION_TARGET_PCT = 85
PROMOTION_MIN_VALIDATION_COVERAGE_PCT = 80
PROMOTION_MODEL_KEYS = {
    "trailing_4_week": "trailing4_v1",
    "seasonal_recent_blend": "seasonal_recent_blend_v1",
}


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


def fetch_rows(url: str, key: str, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{table}?{urllib.parse.urlencode(params)}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def fetch_rows_paged(
    url: str,
    key: str,
    table: str,
    params: dict[str, str],
    page_size: int = 1_000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    while True:
        start = len(rows)
        request = urllib.request.Request(
            f"{url.rstrip('/')}/rest/v1/{table}?{urllib.parse.urlencode(params)}",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range-Unit": "items",
                "Range": f"{start}-{start + page_size - 1}",
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            page = json.loads(response.read())
        rows.extend(page)
        if len(page) < page_size:
            return rows


def post_json(url: str, key: str, path: str, payload: dict[str, Any]) -> Any:
    request = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/{path.lstrip('/')}",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def number(value: Any) -> float:
    result = float(value or 0)
    return result if math.isfinite(result) else 0.0


def prior_month(value: str) -> str:
    first = date.fromisoformat(value).replace(day=1)
    return (first - timedelta(days=1)).replace(day=1).isoformat()


def join_features(weekly: list[dict[str, Any]], crashes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    crash_by_month = {row["month"]: row for row in crashes}
    result = []
    for row in sorted(weekly, key=lambda item: item["week_start"]):
        crash = crash_by_month.get(prior_month(row["week_start"]), {})
        result.append(
            {
                **row,
                "prior_month_crashes": number(crash.get("total_crashes")),
                "prior_month_rain_or_snow_crashes": number(
                    crash.get("rain_or_snow_crashes")
                ),
            }
        )
    return result


def solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    augmented = [row[:] + [value] for row, value in zip(matrix, vector)]
    for column in range(len(vector)):
        pivot = max(range(column, len(vector)), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-12:
            raise ValueError("Forecast feature matrix is singular")
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(len(vector)):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [augmented[row][-1] for row in range(len(vector))]


def fit_ridge(
    rows: list[dict[str, Any]], features: tuple[str, ...], penalty: float = 1.0
) -> Callable[[dict[str, Any]], float]:
    means = [sum(number(row[name]) for row in rows) / len(rows) for name in features]
    scales = []
    for name, mean in zip(features, means):
        variance = sum((number(row[name]) - mean) ** 2 for row in rows) / len(rows)
        scales.append(math.sqrt(variance) or 1.0)
    design = [
        [1.0]
        + [
            (number(row[name]) - mean) / scale
            for name, mean, scale in zip(features, means, scales)
        ]
        for row in rows
    ]
    target = [number(row["repair_orders"]) for row in rows]
    size = len(features) + 1
    normal = [[0.0] * size for _ in range(size)]
    rhs = [0.0] * size
    for values, outcome in zip(design, target):
        for i in range(size):
            rhs[i] += values[i] * outcome
            for j in range(size):
                normal[i][j] += values[i] * values[j]
    for i in range(1, size):
        normal[i][i] += penalty
    coefficients = solve(normal, rhs)

    def predict(row: dict[str, Any]) -> float:
        values = [1.0] + [
            (number(row[name]) - mean) / scale
            for name, mean, scale in zip(features, means, scales)
        ]
        return max(0.0, sum(coefficient * value for coefficient, value in zip(coefficients, values)))

    return predict


def error_metrics(actual: list[float], predicted: list[float]) -> dict[str, float]:
    errors = [prediction - observation for observation, prediction in zip(actual, predicted)]
    return {
        "mae": sum(abs(error) for error in errors) / len(errors),
        "rmse": math.sqrt(sum(error * error for error in errors) / len(errors)),
        "wape_pct": 100 * sum(abs(error) for error in errors) / max(sum(actual), 1),
    }


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(probability * len(ordered)) - 1)
    return ordered[index]


def latest_observed_segment(
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int]:
    """Exclude history before the latest long internal coverage gap."""
    ordered = sorted(rows, key=lambda row: row["week_start"])
    segment_start = 0
    zero_run = 0
    excluded_gap_weeks = 0
    # ponytail: a 26-week zero run is treated as missing coverage; replace this
    # heuristic with explicit source-coverage intervals when FileMaker provides them.
    for index, row in enumerate(ordered):
        if number(row["repair_orders"]) == 0:
            zero_run += 1
        else:
            if zero_run > MAX_INTERNAL_ZERO_WEEKS:
                segment_start = index
                excluded_gap_weeks = zero_run
            zero_run = 0
    segment = ordered[segment_start:]
    if segment_start:
        segment = [
            {
                **row,
                "repair_orders_lag_52_weeks": (
                    None if index < 52 else row.get("repair_orders_lag_52_weeks")
                ),
            }
            for index, row in enumerate(segment)
        ]
    return segment, excluded_gap_weeks


def evaluation_rows(
    rows: list[dict[str, Any]], latest_week_cutoff: str | None
) -> list[dict[str, Any]]:
    """Freeze evaluation at a completed Monday while requiring sources to reach it."""
    if latest_week_cutoff is None:
        return rows
    return [row for row in rows if row["week_start"] <= latest_week_cutoff]


def evaluate_model(
    training: list[dict[str, Any]],
    calibration: list[dict[str, Any]],
    holdout: list[dict[str, Any]],
    predictor: Callable[[list[dict[str, Any]]], Callable[[dict[str, Any]], float]],
) -> dict[str, float]:
    calibration_model = predictor(training)
    calibration_errors = [
        abs(calibration_model(row) - number(row["repair_orders"])) for row in calibration
    ]
    interval = quantile(calibration_errors, 0.8)
    final_model = predictor(training + calibration)
    actual = [number(row["repair_orders"]) for row in holdout]
    predicted = [final_model(row) for row in holdout]
    metrics = error_metrics(actual, predicted)
    metrics.update(
        {
            "interval_80_half_width": interval,
            "interval_80_coverage_pct": 100
            * sum(
                max(0, prediction - interval) <= observation <= prediction + interval
                for observation, prediction in zip(actual, predicted)
            )
            / len(actual),
        }
    )
    return metrics


def evaluate(rows: list[dict[str, Any]], holdout_weeks: int, calibration_weeks: int) -> dict[str, Any]:
    rows, excluded_gap_weeks = latest_observed_segment(rows)
    eligible = [
        row
        for row in rows
        if row.get("repair_orders_lag_52_weeks") is not None
        and row.get("trailing_4_week_average") is not None
    ]
    minimum = holdout_weeks + calibration_weeks + 52
    if len(eligible) < minimum:
        raise ValueError(f"Need at least {minimum} eligible weeks; received {len(eligible)}")
    holdout = eligible[-holdout_weeks:]
    calibration = eligible[-(holdout_weeks + calibration_weeks) : -holdout_weeks]
    training = eligible[: -(holdout_weeks + calibration_weeks)]

    direct = {
        "seasonal_52_week": lambda _: lambda row: number(row["repair_orders_lag_52_weeks"]),
        "trailing_4_week": lambda _: lambda row: number(row["trailing_4_week_average"]),
        "seasonal_recent_blend": lambda _: lambda row: (
            number(row["repair_orders_lag_52_weeks"])
            + number(row["trailing_4_week_average"])
        )
        / 2,
    }
    predictors = {**direct}
    predictors.update(
        {
            name: (lambda fit_rows, names=features: fit_ridge(fit_rows, names))
            for name, features in FEATURE_SETS.items()
        }
    )
    models = {
        name: evaluate_model(training, calibration, holdout, predictor)
        for name, predictor in predictors.items()
    }
    champion = min(models, key=lambda name: models[name]["mae"])
    demand_mae = models["ridge_demand"]["mae"]
    crash_mae = models["ridge_demand_crash"]["mae"]
    weather_mae = models["ridge_demand_weather"]["mae"]
    all_mae = models["ridge_all"]["mae"]
    return {
        "coverage_segment_start": rows[0]["week_start"],
        "excluded_internal_gap_weeks": excluded_gap_weeks,
        "training_start": training[0]["week_start"],
        "training_end": training[-1]["week_start"],
        "calibration_start": calibration[0]["week_start"],
        "calibration_end": calibration[-1]["week_start"],
        "holdout_start": holdout[0]["week_start"],
        "holdout_end": holdout[-1]["week_start"],
        "holdout_weeks": holdout_weeks,
        "holdout_repairs": int(sum(number(row["repair_orders"]) for row in holdout)),
        "models": models,
        "champion": champion,
        "crash_feature_mae_change_pct": 100 * (demand_mae - crash_mae) / demand_mae,
        "weather_feature_mae_change_pct": 100 * (demand_mae - weather_mae) / demand_mae,
        "all_feature_mae_change_pct": 100 * (demand_mae - all_mae) / demand_mae,
    }


DIRECT_MODELS: dict[str, Callable[[dict[str, Any]], float]] = {
    "seasonal_52_week": lambda row: number(row["repair_orders_lag_52_weeks"]),
    "trailing_4_week": lambda row: number(row["trailing_4_week_average"]),
    "seasonal_recent_blend": lambda row: (
        number(row["repair_orders_lag_52_weeks"])
        + number(row["trailing_4_week_average"])
    )
    / 2,
}


def evaluate_direct_shop(
    rows: list[dict[str, Any]], holdout_weeks: int, calibration_weeks: int
) -> dict[str, Any] | None:
    rows, excluded_gap_weeks = latest_observed_segment(rows)
    eligible = [
        row
        for row in rows
        if row.get("repair_orders_lag_52_weeks") is not None
        and row.get("trailing_4_week_average") is not None
    ]
    if len(eligible) < holdout_weeks + calibration_weeks:
        return None
    holdout = eligible[-holdout_weeks:]
    calibration = eligible[-(holdout_weeks + calibration_weeks) : -holdout_weeks]
    actual = [number(row["repair_orders"]) for row in holdout]
    models: dict[str, dict[str, Any]] = {}
    for name, predictor in DIRECT_MODELS.items():
        calibration_errors = [
            abs(predictor(row) - number(row["repair_orders"])) for row in calibration
        ]
        interval = quantile(calibration_errors, 0.8)
        predicted = [predictor(row) for row in holdout]
        metrics = error_metrics(actual, predicted)
        metrics.update(
            {
                "interval_80_half_width": interval,
                "interval_80_covered": sum(
                    max(0, prediction - interval) <= observation <= prediction + interval
                    for observation, prediction in zip(actual, predicted)
                ),
                "actual": actual,
                "predicted": predicted,
            }
        )
        models[name] = metrics
    champion = min(DIRECT_MODELS, key=lambda name: models[name]["mae"])
    return {
        "source_shop_key": rows[0]["source_shop_key"],
        "source_shop_name": rows[0].get("source_shop_name"),
        "mapped": any(row.get("shop_id") is not None for row in rows),
        "coverage_segment_start": rows[0]["week_start"],
        "excluded_internal_gap_weeks": excluded_gap_weeks,
        "holdout_start": holdout[0]["week_start"],
        "holdout_end": holdout[-1]["week_start"],
        "holdout_repairs": int(sum(actual)),
        "models": models,
        "champion": champion,
    }


def summarize_direct_shop(result: dict[str, Any]) -> dict[str, Any]:
    models = {}
    for name, values in result["models"].items():
        observations = len(values["actual"])
        models[name] = {
            key: value
            for key, value in values.items()
            if key not in {"actual", "predicted", "interval_80_covered"}
        }
        models[name]["interval_80_coverage_pct"] = (
            100 * values["interval_80_covered"] / observations
        )
    seasonal_mae = models["seasonal_52_week"]["mae"]
    champion_mae = models[result["champion"]]["mae"]
    return {
        **{key: value for key, value in result.items() if key != "models"},
        "scope": "filemaker_shop",
        "models": models,
        "mae_improvement_pct": (
            100 * (seasonal_mae - champion_mae) / seasonal_mae
            if seasonal_mae
            else 0
        ),
    }


def interval_coverage(
    shops: list[dict[str, Any]], model_name: str, multiplier: float
) -> float:
    covered = observations = 0
    for shop in shops:
        model = shop["models"][model_name]
        half_width = model["interval_80_half_width"] * multiplier
        for actual, predicted in zip(model["actual"], model["predicted"]):
            covered += max(0, predicted - half_width) <= actual <= predicted + half_width
            observations += 1
    return 100 * covered / observations if observations else 0


def interval_policy(
    shops: list[dict[str, Any]], model_name: str
) -> dict[str, float | int | None]:
    if len(shops) < 2:
        return {
            "interval_multiplier": 1.0,
            "interval_policy_calibration_target_pct": INTERVAL_CALIBRATION_TARGET_PCT,
            "interval_policy_calibration_shops": len(shops),
            "interval_policy_validation_shops": 0,
            "interval_policy_calibration_coverage_pct": interval_coverage(
                shops, model_name, 1.0
            ),
            "interval_policy_validation_coverage_pct": None,
        }
    calibration = [
        shop
        for shop in shops
        if int(hashlib.sha256(shop["source_shop_key"].encode()).hexdigest()[:8], 16)
        % 2
        == 0
    ]
    validation = [shop for shop in shops if shop not in calibration]
    if not calibration or not validation:
        ordered = sorted(shops, key=lambda shop: shop["source_shop_key"])
        calibration, validation = ordered[::2], ordered[1::2]
    multipliers = [1 + step / 20 for step in range(21)]
    selected = next(
        (
            multiplier
            for multiplier in multipliers
            if interval_coverage(calibration, model_name, multiplier)
            >= INTERVAL_CALIBRATION_TARGET_PCT
        ),
        multipliers[-1],
    )
    return {
        "interval_multiplier": selected,
        "interval_policy_calibration_target_pct": INTERVAL_CALIBRATION_TARGET_PCT,
        "interval_policy_calibration_shops": len(calibration),
        "interval_policy_validation_shops": len(validation),
        "interval_policy_calibration_coverage_pct": interval_coverage(
            calibration, model_name, selected
        ),
        "interval_policy_validation_coverage_pct": interval_coverage(
            validation, model_name, selected
        ),
    }


def evaluate_filemaker_shops(
    rows: list[dict[str, Any]],
    holdout_weeks: int,
    calibration_weeks: int,
    latest_week_cutoff: str | None = None,
) -> dict[str, Any]:
    by_shop: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_shop[row["source_shop_key"]].append(row)
    candidate_shops = [
        shop_rows
        for shop_rows in by_shop.values()
        if latest_week_cutoff is None
        or max(row["week_start"] for row in shop_rows) >= latest_week_cutoff
    ]
    shop_results = []
    for shop_rows in candidate_shops:
        result = evaluate_direct_shop(
            sorted(shop_rows, key=lambda row: row["week_start"]),
            holdout_weeks,
            calibration_weeks,
        )
        if result:
            shop_results.append(result)
    if not shop_results:
        raise ValueError("No source shop has enough eligible history for evaluation")

    models: dict[str, dict[str, Any]] = {}
    for name in DIRECT_MODELS:
        actual = [
            value
            for shop in shop_results
            for value in shop["models"][name]["actual"]
        ]
        predicted = [
            value
            for shop in shop_results
            for value in shop["models"][name]["predicted"]
        ]
        metrics = error_metrics(actual, predicted)
        metrics.update(
            {
                "macro_mae": sum(shop["models"][name]["mae"] for shop in shop_results)
                / len(shop_results),
                "interval_80_mean_half_width": sum(
                    shop["models"][name]["interval_80_half_width"]
                    for shop in shop_results
                )
                / len(shop_results),
                "interval_80_coverage_pct": 100
                * sum(
                    shop["models"][name]["interval_80_covered"]
                    for shop in shop_results
                )
                / len(actual),
                "shops_beating_seasonal": sum(
                    shop["models"][name]["mae"]
                    < shop["models"]["seasonal_52_week"]["mae"]
                    for shop in shop_results
                ),
                "champion_shops": sum(shop["champion"] == name for shop in shop_results),
                **interval_policy(shop_results, name),
            }
        )
        models[name] = metrics

    champion = min(DIRECT_MODELS, key=lambda name: models[name]["mae"])
    seasonal_mae = models["seasonal_52_week"]["mae"]
    recent_mae = models["trailing_4_week"]["mae"]
    return {
        "scope": "filemaker_multishop",
        "source_shops": len(by_shop),
        "candidate_source_shops": len(candidate_shops),
        "eligible_shops": len(shop_results),
        "excluded_by_latest_week": len(by_shop) - len(candidate_shops),
        "excluded_for_history": len(candidate_shops) - len(shop_results),
        "latest_week_cutoff": latest_week_cutoff,
        "mapped_eligible_shops": sum(shop["mapped"] for shop in shop_results),
        "holdout_weeks_per_shop": holdout_weeks,
        "calibration_weeks_per_shop": calibration_weeks,
        "holdout_shop_weeks": holdout_weeks * len(shop_results),
        "holdout_repairs": sum(shop["holdout_repairs"] for shop in shop_results),
        "holdout_start_range": [
            min(shop["holdout_start"] for shop in shop_results),
            max(shop["holdout_start"] for shop in shop_results),
        ],
        "holdout_end_range": [
            min(shop["holdout_end"] for shop in shop_results),
            max(shop["holdout_end"] for shop in shop_results),
        ],
        "shops": [
            summarize_direct_shop(shop)
            for shop in sorted(shop_results, key=lambda item: item["source_shop_key"])
        ],
        "models": models,
        "champion": champion,
        "trailing_4_beats_seasonal": recent_mae < seasonal_mae,
        "trailing_4_mae_improvement_pct": (
            100 * (seasonal_mae - recent_mae) / seasonal_mae
            if seasonal_mae
            else 0
        ),
    }


def rows_for_horizon(
    rows: list[dict[str, Any]], horizon: int
) -> list[dict[str, Any]]:
    """Rebuild the recent-demand feature using only data known at forecast origin."""
    if not 1 <= horizon <= 4:
        raise ValueError("Forecast horizon must be between 1 and 4 weeks")
    ordered = sorted(rows, key=lambda row: row["week_start"])
    result = []
    for index, row in enumerate(ordered):
        origin = index - horizon + 1
        history = ordered[origin - 4 : origin] if origin >= 4 else []
        result.append(
            {
                **row,
                "trailing_4_week_average": (
                    sum(number(item["repair_orders"]) for item in history) / 4
                    if len(history) == 4
                    else None
                ),
            }
        )
    return result


def evaluate_filemaker_horizons(
    rows: list[dict[str, Any]],
    holdout_weeks: int,
    calibration_weeks: int,
    horizons: int,
    latest_week_cutoff: str | None = None,
) -> dict[str, Any]:
    by_shop: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_shop[row["source_shop_key"]].append(row)
    results = {}
    for horizon in range(1, horizons + 1):
        horizon_rows = [
            row
            for shop_rows in by_shop.values()
            for row in rows_for_horizon(shop_rows, horizon)
        ]
        results[str(horizon)] = evaluate_filemaker_shops(
            horizon_rows,
            holdout_weeks,
            calibration_weeks,
            latest_week_cutoff,
        )
    return {
        "scope": "filemaker_multishop_horizons",
        "forecast_horizons": horizons,
        "latest_week_cutoff": latest_week_cutoff,
        "horizons": results,
        "trailing_4_beats_seasonal_at_every_horizon": all(
            result["trailing_4_beats_seasonal"] for result in results.values()
        ),
    }


def evaluate_direct_shop_horizons(
    rows: list[dict[str, Any]],
    holdout_weeks: int,
    calibration_weeks: int,
    horizons: int,
) -> dict[str, Any]:
    results = {}
    for horizon in range(1, horizons + 1):
        result = evaluate_direct_shop(
            rows_for_horizon(rows, horizon), holdout_weeks, calibration_weeks
        )
        if not result:
            raise ValueError(
                "Shop does not have enough history after excluding long internal "
                f"coverage gaps for horizon {horizon}"
            )
        results[str(horizon)] = summarize_direct_shop(result)
    return {
        "scope": "filemaker_shop_horizons",
        "source_shop_key": rows[0]["source_shop_key"],
        "source_shop_name": rows[0].get("source_shop_name"),
        "forecast_horizons": horizons,
        "horizons": results,
    }


def build_promotion_candidate(
    result: dict[str, Any], source_shop_key: str
) -> dict[str, Any]:
    horizons = []
    mapped = False
    source_shop_name = source_shop_key
    for horizon, horizon_result in result["horizons"].items():
        shop = next(
            (
                candidate
                for candidate in horizon_result["shops"]
                if candidate["source_shop_key"] == source_shop_key
            ),
            None,
        )
        if not shop:
            raise ValueError(
                f"{source_shop_key} is not eligible under the current history and "
                "latest-week gates"
            )
        mapped = mapped or shop["mapped"]
        source_shop_name = shop.get("source_shop_name") or source_shop_key
        seasonal_mae = shop["models"]["seasonal_52_week"]["mae"]
        eligible_models = []
        for model_name, model_key in PROMOTION_MODEL_KEYS.items():
            model = shop["models"][model_name]
            policy = horizon_result["models"][model_name]
            validation_coverage = (
                policy["interval_policy_validation_coverage_pct"] or 0
            )
            if (
                model["mae"] < seasonal_mae
                and validation_coverage >= PROMOTION_MIN_VALIDATION_COVERAGE_PCT
            ):
                eligible_models.append((model["mae"], model_name, model_key))
        if not eligible_models:
            horizons.append(
                {
                    "forecast_horizon_weeks": int(horizon),
                    "promotion_ready": False,
                    "reason": (
                        "No supported model both beats the shop seasonal baseline and "
                        "clears the held-out-shop interval coverage gate."
                    ),
                }
            )
            continue
        _, model_name, model_key = min(eligible_models)
        model = shop["models"][model_name]
        policy = horizon_result["models"][model_name]
        interval_multiplier = policy["interval_multiplier"]
        base_interval_half_width = model["interval_80_half_width"]
        improvement = 100 * (seasonal_mae - model["mae"]) / seasonal_mae
        horizons.append(
            {
                "forecast_horizon_weeks": int(horizon),
                "promotion_ready": True,
                "model_key": model_key,
                "seasonal_baseline_mae": seasonal_mae,
                "model_mae": model["mae"],
                "model_wape_pct": model["wape_pct"],
                "mae_improvement_pct": improvement,
                "calibration_weeks": horizon_result["calibration_weeks_per_shop"],
                "holdout_weeks": horizon_result["holdout_weeks_per_shop"],
                "holdout_start": shop["holdout_start"],
                "holdout_end": shop["holdout_end"],
                "base_interval_half_width": base_interval_half_width,
                "interval_multiplier": interval_multiplier,
                "interval_half_width": math.ceil(
                    base_interval_half_width * interval_multiplier
                ),
                "interval_validation_coverage_pct": policy[
                    "interval_policy_validation_coverage_pct"
                ],
                "evaluation_scope": (
                    f"{source_shop_key} chronological holdout; nominal 80% interval "
                    f"evaluated through {horizon_result['latest_week_cutoff']} and "
                    f"calibrated to {policy['interval_policy_calibration_target_pct']}% "
                    f"on {policy['interval_policy_calibration_shops']} current source "
                    f"shops and validated on "
                    f"{policy['interval_policy_validation_shops']} held-out shops."
                ),
            }
        )
    evaluation_passed = len(horizons) == 4 and all(
        horizon["promotion_ready"] for horizon in horizons
    )
    return {
        "scope": "filemaker_promotion_candidate",
        "source_shop_key": source_shop_key,
        "source_shop_name": source_shop_name,
        "mapped": mapped,
        "evaluation_passed": evaluation_passed,
        "review_staging_ready": evaluation_passed and mapped,
        "promotion_status": "review",
        "horizons": horizons,
        "limitation": (
            "This predicts aggregate shop repair arrivals, not individual crashes or "
            "insurer claim volume. Evaluation evidence does not approve or publish a "
            "forecast."
        ),
    }


def stage_promotion_review(
    url: str,
    key: str,
    candidate: dict[str, Any],
    actor_profile_id: str | None,
    review_notes: str | None,
) -> dict[str, Any]:
    if not candidate["review_staging_ready"]:
        raise ValueError(
            "Review staging requires four passing horizons and a confirmed shop mapping"
        )
    try:
        actor = str(uuid.UUID(actor_profile_id or ""))
    except ValueError as error:
        raise ValueError("--actor-profile-id must be a UUID") from error
    notes = (review_notes or "").strip()
    if not 20 <= len(notes) <= 1000:
        raise ValueError("--review-notes must contain 20 to 1000 characters")
    staged = post_json(
        url,
        key,
        "rpc/stage_collision_forecast_model_review",
        {
            "p_source_system": "filemaker_repair_customer",
            "p_source_shop_key": candidate["source_shop_key"],
            "p_horizons": candidate["horizons"],
            "p_actor_profile_id": actor,
            "p_review_notes": notes,
        },
    )
    return {
        "scope": "filemaker_promotion_review_staged",
        **staged,
        "limitation": candidate["limitation"],
    }


def print_markdown(result: dict[str, Any]) -> None:
    print("# Crash and Weather Feature Evaluation")
    print()
    print(
        f"Training: {result['training_start']}–{result['training_end']}; calibration: "
        f"{result['calibration_start']}–{result['calibration_end']}; holdout: "
        f"{result['holdout_start']}–{result['holdout_end']} "
        f"({result['holdout_weeks']} weeks, {result['holdout_repairs']} repairs)."
    )
    print()
    print("| Model | MAE | RMSE | WAPE | 80% interval | Coverage |")
    print("|---|---:|---:|---:|---:|---:|")
    for name, metrics in result["models"].items():
        print(
            f"| {name} | {metrics['mae']:.2f} | {metrics['rmse']:.2f} | "
            f"{metrics['wape_pct']:.1f}% | ±{metrics['interval_80_half_width']:.1f} | "
            f"{metrics['interval_80_coverage_pct']:.1f}% |"
        )
    print()
    print(f"Observed holdout champion: **{result['champion']}**.")
    print(
        "Crash feature MAE change vs demand-only ridge: "
        f"{result['crash_feature_mae_change_pct']:+.1f}%."
    )
    print(
        "Weather feature MAE change vs demand-only ridge: "
        f"{result['weather_feature_mae_change_pct']:+.1f}%."
    )
    print(
        "Scope: one pilot company. Positive change means lower error; no result "
        "supports predicting individual crashes or insurance claims."
    )


def print_multishop_markdown(result: dict[str, Any]) -> None:
    print("# Multi-shop Repair-Demand Baseline Evaluation")
    print()
    print(
        f"Eligible source shops: {result['eligible_shops']} of {result['source_shops']}; "
        f"holdout: {result['holdout_shop_weeks']} shop-weeks and "
        f"{result['holdout_repairs']} repairs."
    )
    print()
    print(
        "| Model | MAE | RMSE | WAPE | Base interval | Base coverage | "
        "Scale | Held-out-shop coverage | Shop champions |"
    )
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for name, metrics in result["models"].items():
        print(
            f"| {name} | {metrics['mae']:.2f} | "
            f"{metrics['rmse']:.2f} | {metrics['wape_pct']:.1f}% | "
            f"±{metrics['interval_80_mean_half_width']:.1f} | "
            f"{metrics['interval_80_coverage_pct']:.1f}% | "
            f"{metrics['interval_multiplier']:.2f}× | "
            f"{metrics['interval_policy_validation_coverage_pct']:.1f}% | "
            f"{metrics['champion_shops']} |"
        )
    print()
    print(f"Aggregate champion: **{result['champion']}**.")
    print(
        "Trailing-four-week MAE change versus seasonal: "
        f"{result['trailing_4_mae_improvement_pct']:+.1f}%."
    )
    print(
        "Unmapped source shops are evaluation-only. This predicts repair arrivals, "
        "not individual crashes or insurer claim volume."
    )


def print_direct_shop_markdown(result: dict[str, Any]) -> None:
    print(f"# {result['source_shop_key']} Repair-Demand Evaluation")
    print()
    print(
        f"Holdout: {result['holdout_start']}–{result['holdout_end']} "
        f"({result['holdout_repairs']} repairs)."
    )
    print()
    print("| Model | MAE | RMSE | WAPE | 80% interval | Coverage |")
    print("|---|---:|---:|---:|---:|---:|")
    for name, metrics in result["models"].items():
        print(
            f"| {name} | {metrics['mae']:.2f} | {metrics['rmse']:.2f} | "
            f"{metrics['wape_pct']:.1f}% | ±{metrics['interval_80_half_width']:.1f} | "
            f"{metrics['interval_80_coverage_pct']:.1f}% |"
        )
    print()
    print(f"Observed holdout champion: **{result['champion']}**.")


def print_horizon_markdown(result: dict[str, Any]) -> None:
    print("# Multi-horizon Repair-Demand Evaluation")
    print()
    print(
        "Horizon 1 is the week beginning at the forecast origin; later horizons "
        "use the same information cutoff."
    )
    print()
    print(
        "| Horizon | Eligible shops | Seasonal MAE | Trailing-4 MAE | "
        "MAE improvement | Interval scale | Held-out-shop interval coverage |"
    )
    print("|---:|---:|---:|---:|---:|---:|---:|")
    for horizon, horizon_result in result["horizons"].items():
        seasonal = horizon_result["models"]["seasonal_52_week"]
        recent = horizon_result["models"]["trailing_4_week"]
        print(
            f"| {horizon} | {horizon_result['eligible_shops']} | "
            f"{seasonal['mae']:.2f} | {recent['mae']:.2f} | "
            f"{horizon_result['trailing_4_mae_improvement_pct']:.1f}% | "
            f"{recent['interval_multiplier']:.2f}× | "
            f"{recent['interval_policy_validation_coverage_pct']:.1f}% |"
        )
    print()
    print(
        f"Nominal 80% intervals are calibrated to "
        f"{INTERVAL_CALIBRATION_TARGET_PCT}% coverage on calibration shops before "
        "held-out-shop validation."
    )
    print(
        "Trailing four-week demand beats seasonal at every horizon: "
        f"**{result['trailing_4_beats_seasonal_at_every_horizon']}**."
    )
    print(
        "This predicts aggregate shop repair arrivals, not individual crashes or "
        "insurer claim volume."
    )


def print_direct_horizon_markdown(result: dict[str, Any]) -> None:
    print(f"# {result['source_shop_key']} Multi-horizon Repair-Demand Evaluation")
    print()
    print("| Horizon | Champion | Seasonal MAE | Champion MAE | Improvement |")
    print("|---:|---|---:|---:|---:|")
    for horizon, horizon_result in result["horizons"].items():
        seasonal = horizon_result["models"]["seasonal_52_week"]["mae"]
        champion = horizon_result["champion"]
        champion_mae = horizon_result["models"][champion]["mae"]
        improvement = 100 * (seasonal - champion_mae) / seasonal if seasonal else 0
        print(
            f"| {horizon} | {champion} | {seasonal:.2f} | "
            f"{champion_mae:.2f} | {improvement:.1f}% |"
        )


def print_promotion_candidate_markdown(result: dict[str, Any]) -> None:
    print(f"# {result['source_shop_name']} Forecast Promotion Candidate")
    print()
    print(
        "Evaluation: **{}**; shop mapping: **{}**; review staging: **{}**.".format(
            "passed" if result["evaluation_passed"] else "blocked",
            "confirmed" if result["mapped"] else "pending",
            "ready" if result["review_staging_ready"] else "not ready",
        )
    )
    print()
    print(
        "| Horizon | Model | Seasonal MAE | Model MAE | Improvement | "
        "80% interval | Held-out-shop coverage |"
    )
    print("|---:|---|---:|---:|---:|---:|---:|")
    for horizon in result["horizons"]:
        if not horizon["promotion_ready"]:
            print(
                f"| {horizon['forecast_horizon_weeks']} | blocked | — | — | — | — | — |"
            )
            continue
        print(
            f"| {horizon['forecast_horizon_weeks']} | {horizon['model_key']} | "
            f"{horizon['seasonal_baseline_mae']:.2f} | "
            f"{horizon['model_mae']:.2f} | "
            f"{horizon['mae_improvement_pct']:.1f}% | "
            f"±{horizon['interval_half_width']} | "
            f"{horizon['interval_validation_coverage_pct']:.1f}% |"
        )
    print()
    print(result["limitation"])


def print_staged_review_markdown(result: dict[str, Any]) -> None:
    print("# Forecast Model Review Staged")
    print()
    print(
        f"{result['source_shop_key']} has {result['staged_horizons']} horizons in "
        f"**{result['promotion_status']}**. Forecasts published: "
        f"**{result['forecasts_published']}**."
    )
    print()
    print(result["limitation"])


def self_test() -> None:
    rows = [{"x": value, "repair_orders": 2 + 3 * value} for value in range(1, 10)]
    model = fit_ridge(rows, ("x",), penalty=1e-8)
    assert abs(model({"x": 10}) - 32) < 1e-5
    assert prior_month("2026-01-12") == "2025-12-01"
    assert quantile([1, 2, 3, 4, 5], 0.8) == 4
    assert evaluation_rows(
        [{"week_start": "2026-08-03"}, {"week_start": "2026-08-10"}],
        "2026-08-03",
    ) == [{"week_start": "2026-08-03"}]
    assert error_metrics([10, 12], [9, 14])["mae"] == 1.5
    weekly = [
        {
            "source_shop_key": "TEST",
            "source_shop_name": "Test Shop",
            "shop_id": None,
            "week_start": (date(2020, 1, 6) + timedelta(weeks=index)).isoformat(),
            "repair_orders": 10,
            "repair_orders_lag_52_weeks": 20,
            "trailing_4_week_average": 10,
        }
        for index in range(30)
    ]
    multishop = evaluate_filemaker_shops(weekly, holdout_weeks=10, calibration_weeks=10)
    assert multishop["champion"] == "trailing_4_week"
    assert multishop["eligible_shops"] == 1
    assert multishop["models"]["trailing_4_week"]["mae"] == 0
    direct_result = evaluate_direct_shop(weekly, 10, 10)
    direct = summarize_direct_shop(direct_result)
    assert direct["scope"] == "filemaker_shop"
    assert direct["models"]["trailing_4_week"]["interval_80_coverage_pct"] == 100
    assert (
        interval_policy([direct_result], "trailing_4_week")[
            "interval_policy_calibration_target_pct"
        ]
        == 85
    )
    varying = [{**row, "repair_orders": index} for index, row in enumerate(weekly)]
    horizon_three = rows_for_horizon(varying, 3)
    assert horizon_three[10]["trailing_4_week_average"] == 5.5
    assert horizon_three[10]["trailing_4_week_average"] == rows_for_horizon(
        [
            {**row, "repair_orders": 999} if index in {8, 9} else row
            for index, row in enumerate(varying)
        ],
        3,
    )[10]["trailing_4_week_average"]
    gapped = [
        {
            **weekly[index % len(weekly)],
            "week_start": (date(2020, 1, 6) + timedelta(weeks=index)).isoformat(),
            "repair_orders": 0 if 10 <= index < 40 else 10,
        }
        for index in range(130)
    ]
    current_segment, excluded_gap_weeks = latest_observed_segment(gapped)
    assert excluded_gap_weeks == 30
    assert current_segment[0]["week_start"] == "2020-10-12"
    assert current_segment[0]["repair_orders_lag_52_weeks"] is None
    assert current_segment[52]["repair_orders_lag_52_weeks"] == 20
    assert evaluate_direct_shop(gapped, 52, 52) is None
    candidate = build_promotion_candidate(
        evaluate_filemaker_horizons(
            weekly
            + [
                {
                    **row,
                    "source_shop_key": "TEST2",
                    "source_shop_name": "Test Shop 2",
                }
                for row in weekly
            ],
            holdout_weeks=10,
            calibration_weeks=10,
            horizons=4,
        ),
        "TEST",
    )
    assert candidate["evaluation_passed"] is True
    assert candidate["review_staging_ready"] is False
    assert len(candidate["horizons"]) == 4
    try:
        stage_promotion_review(
            "https://example.supabase.co",
            "test-key",
            candidate,
            "00000000-0000-4000-8000-000000000001",
            "Synthetic evaluation evidence for the self-test.",
        )
        raise AssertionError("Unmapped promotion evidence must not be staged")
    except ValueError as error:
        assert "confirmed shop mapping" in str(error)


def run(args: argparse.Namespace) -> dict[str, Any]:
    if not args.env_file:
        raise ValueError("--env-file is required")
    if args.holdout_weeks < 1 or args.calibration_weeks < 1:
        raise ValueError("Holdout and calibration windows must be positive")
    if not 1 <= args.forecast_horizons <= 4:
        raise ValueError("--forecast-horizons must be between 1 and 4")
    if args.latest_week_cutoff:
        cutoff = date.fromisoformat(args.latest_week_cutoff)
        today = datetime.now(timezone.utc).date()
        current_monday = today - timedelta(days=today.weekday())
        if cutoff.weekday() != 0 or cutoff >= current_monday:
            raise ValueError(
                "--latest-week-cutoff must be a completed Monday before the current week"
            )
    promotion_candidate = (args.promotion_candidate or "").strip().upper()
    if args.stage_review and not promotion_candidate:
        raise ValueError("--stage-review requires --promotion-candidate")
    if promotion_candidate:
        if not re.fullmatch(r"PS[0-9]+", promotion_candidate):
            raise ValueError("--promotion-candidate must match PS followed by digits")
        if not args.latest_week_cutoff:
            raise ValueError("--promotion-candidate requires --latest-week-cutoff")
    env = load_env(Path(args.env_file))
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    if args.project_id not in url:
        raise ValueError("Supabase URL does not match --project-id")
    if args.source_shop_key:
        source_shop_key = args.source_shop_key.strip().upper()
        if not re.fullmatch(r"PS[0-9]+", source_shop_key):
            raise ValueError("--source-shop-key must match PS followed by digits")
        rows = fetch_rows(
            url,
            key,
            "v_collision_filemaker_forecast_training_weekly",
            {
                "select": (
                    "source_shop_key,source_shop_name,shop_id,week_start,repair_orders,"
                    "repair_orders_lag_52_weeks,trailing_4_week_average"
                ),
                "source_shop_key": f"eq.{source_shop_key}",
                "order": "week_start.asc",
            },
        )
        rows = evaluation_rows(rows, args.latest_week_cutoff)
        if args.forecast_horizons > 1:
            return evaluate_direct_shop_horizons(
                rows,
                args.holdout_weeks,
                args.calibration_weeks,
                args.forecast_horizons,
            )
        result = evaluate_direct_shop(rows, args.holdout_weeks, args.calibration_weeks)
        if not result:
            raise ValueError(
                f"{source_shop_key} does not have enough history after excluding "
                "long internal coverage gaps"
            )
        return summarize_direct_shop(result)
    if args.all_filemaker or promotion_candidate:
        rows = fetch_rows_paged(
            url,
            key,
            "v_collision_filemaker_forecast_training_weekly",
            {
                "select": (
                    "source_shop_key,source_shop_name,shop_id,week_start,repair_orders,"
                    "repair_orders_lag_52_weeks,trailing_4_week_average"
                ),
                "order": "source_shop_key.asc,week_start.asc",
            },
        )
        rows = evaluation_rows(rows, args.latest_week_cutoff)
        if args.forecast_horizons > 1 or promotion_candidate:
            result = evaluate_filemaker_horizons(
                rows,
                args.holdout_weeks,
                args.calibration_weeks,
                4 if promotion_candidate else args.forecast_horizons,
                args.latest_week_cutoff,
            )
            candidate = (
                build_promotion_candidate(result, promotion_candidate)
                if promotion_candidate
                else result
            )
            return (
                stage_promotion_review(
                    url,
                    key,
                    candidate,
                    args.actor_profile_id,
                    args.review_notes,
                )
                if promotion_candidate and args.stage_review
                else candidate
            )
        return evaluate_filemaker_shops(
            rows, args.holdout_weeks, args.calibration_weeks, args.latest_week_cutoff
        )
    if not args.shop_id:
        raise ValueError("--shop-id is required unless --all-filemaker is used")
    weekly = fetch_rows(
        url,
        key,
        "v_collision_forecast_training_weekly",
        {
            "select": (
                "week_start,repair_orders,repair_orders_lag_52_weeks,"
                "trailing_4_week_average,prior_month_weighted_storm_demand_score"
            ),
            "shop_id": f"eq.{args.shop_id}",
            "order": "week_start.asc",
        },
    )
    crashes = fetch_rows(
        url,
        key,
        "v_collision_ksdot_monthly",
        {
            "select": "month,total_crashes,rain_or_snow_crashes",
            "shop_id": f"eq.{args.shop_id}",
            "order": "month.asc",
        },
    )
    return evaluate(join_features(weekly, crashes), args.holdout_weeks, args.calibration_weeks)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file")
    parser.add_argument("--shop-id")
    parser.add_argument("--source-shop-key")
    parser.add_argument("--promotion-candidate")
    parser.add_argument("--stage-review", action="store_true")
    parser.add_argument("--actor-profile-id")
    parser.add_argument("--review-notes")
    parser.add_argument("--project-id", default="gylkkzmcmbdftxieyabw")
    parser.add_argument("--all-filemaker", action="store_true")
    parser.add_argument(
        "--latest-week-cutoff",
        help=(
            "require source history to reach this completed Monday and exclude "
            "all later, potentially partial weeks from evaluation"
        ),
    )
    parser.add_argument("--holdout-weeks", type=int, default=52)
    parser.add_argument("--calibration-weeks", type=int, default=52)
    parser.add_argument("--forecast-horizons", type=int, default=1)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    if arguments.self_test:
        self_test()
        print("ok")
    else:
        result = run(arguments)
        if arguments.json:
            print(json.dumps(result, indent=2))
        elif result.get("scope") == "filemaker_multishop_horizons":
            print_horizon_markdown(result)
        elif result.get("scope") == "filemaker_shop_horizons":
            print_direct_horizon_markdown(result)
        elif result.get("scope") == "filemaker_promotion_candidate":
            print_promotion_candidate_markdown(result)
        elif result.get("scope") == "filemaker_promotion_review_staged":
            print_staged_review_markdown(result)
        elif result.get("scope") == "filemaker_multishop":
            print_multishop_markdown(result)
        elif result.get("scope") == "filemaker_shop":
            print_direct_shop_markdown(result)
        else:
            print_markdown(result)
