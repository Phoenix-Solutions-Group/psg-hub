#!/usr/bin/env python3
"""Backtest whether severe-weather ZIP signals precede unusual repair arrivals."""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any


PROJECT_ID = "gylkkzmcmbdftxieyabw"
WEATHER_START = date(2016, 1, 1)
MIN_PRIOR_SEASONS = 2


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
        if len(rows) % 50_000 == 0:
            print(f"{table}: fetched {len(rows):,} rows", file=sys.stderr, flush=True)


def month(value: str) -> date:
    parsed = date.fromisoformat(value[:10])
    return parsed.replace(day=1)


def add_months(value: date, count: int) -> date:
    index = value.year * 12 + value.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def month_span(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current = add_months(current, 1)


def number(value: Any) -> float:
    result = float(value or 0)
    return result if math.isfinite(result) else 0.0


def signal_types(row: dict[str, Any]) -> tuple[str, ...]:
    types: list[str] = []
    if number(row.get("tornado_events")) > 0:
        types.append("tornado")
    if number(row.get("max_hail_size")) >= 1:
        types.append("hail")
    # NCEI Storm Events wind magnitude is knots; 50 kt is approximately 58 mph.
    if number(row.get("max_wind_speed")) >= 50:
        types.append("wind")
    return tuple(types)


def wilson(successes: int, total: int) -> dict[str, float] | None:
    if not total:
        return None
    z = 1.96
    rate = successes / total
    denominator = 1 + z * z / total
    center = (rate + z * z / (2 * total)) / denominator
    margin = (
        z
        * math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total))
        / denominator
    )
    return {
        "rate_pct": round(rate * 100, 2),
        "lower_95_pct": round(max(0, center - margin) * 100, 2),
        "upper_95_pct": round(min(1, center + margin) * 100, 2),
    }


def summarize(cases: list[dict[str, Any]]) -> dict[str, Any]:
    hits = sum(case["follow_through"] for case in cases)
    return {
        "cases": len(cases),
        "follow_through_cases": hits,
        "no_follow_through_cases": len(cases) - hits,
        "follow_through": wilson(hits, len(cases)),
        "average_repair_uplift": round(
            sum(case["actual"] - case["baseline"] for case in cases)
            / max(len(cases), 1),
            3,
        ),
    }


def compare(
    signal_cases: list[dict[str, Any]], control_cases: list[dict[str, Any]]
) -> dict[str, Any]:
    signal = summarize(signal_cases)
    control = summarize(control_cases)
    signal_rate = (signal["follow_through"] or {}).get("rate_pct")
    control_rate = (control["follow_through"] or {}).get("rate_pct")
    return {
        "signal": signal,
        "control": control,
        "signal_rate_lift_percentage_points": (
            None
            if signal_rate is None or control_rate is None
            else round(signal_rate - control_rate, 2)
        ),
    }


def exposure_tier(prior_repairs: int) -> str:
    if prior_repairs < 5:
        return "0-4 prior repairs"
    if prior_repairs < 10:
        return "5-9 prior repairs"
    if prior_repairs < 25:
        return "10-24 prior repairs"
    return "25+ prior repairs"


def evaluate(
    repair_rows: list[dict[str, Any]],
    weather_rows: list[dict[str, Any]],
    boundary_zips: set[str],
    minimum_prior_seasons: int = MIN_PRIOR_SEASONS,
) -> dict[str, Any]:
    repair_counts: dict[tuple[str, str, date], int] = defaultdict(int)
    first_month: dict[tuple[str, str], date] = {}
    latest_date: dict[str, date] = {}
    valid_repairs = 0
    for row in repair_rows:
        shop = str(row.get("source_shop_key") or "").strip()
        zip_code = str(row.get("customer_zip") or "").strip()
        arrival = row.get("arrival_date")
        if not shop or len(zip_code) != 5 or not zip_code.isdigit() or not arrival:
            continue
        arrival_date = date.fromisoformat(str(arrival)[:10])
        repair_month = arrival_date.replace(day=1)
        if repair_month < WEATHER_START:
            continue
        valid_repairs += 1
        key = (shop, zip_code)
        repair_counts[(shop, zip_code, repair_month)] += 1
        first_month[key] = min(first_month.get(key, repair_month), repair_month)
        latest_date[shop] = max(latest_date.get(shop, arrival_date), arrival_date)

    signals: dict[tuple[str, date], tuple[str, ...]] = {}
    for row in weather_rows:
        zip_code = str(row.get("zip") or "").strip()
        types = signal_types(row)
        if zip_code in boundary_zips and types:
            signals[(zip_code, month(str(row["month"])))] = types

    signal_cases: list[dict[str, Any]] = []
    control_cases: list[dict[str, Any]] = []
    by_signal: dict[str, list[dict[str, Any]]] = defaultdict(list)
    signal_by_exposure: dict[str, list[dict[str, Any]]] = defaultdict(list)
    control_by_exposure: dict[str, list[dict[str, Any]]] = defaultdict(list)
    evaluated_shops: set[str] = set()
    evaluated_zips: set[str] = set()

    for (shop, zip_code), start in first_month.items():
        if zip_code not in boundary_zips:
            continue
        last_complete_month = add_months(latest_date[shop].replace(day=1), -1)
        last_exposure_month = add_months(last_complete_month, -1)
        if last_exposure_month < start:
            continue

        prior_repairs = 0
        for exposure_month in month_span(start, last_exposure_month):
            outcome_month = add_months(exposure_month, 1)
            current_repairs = repair_counts.get((shop, zip_code, exposure_month), 0)
            seasonal_months = [
                date(year, outcome_month.month, 1)
                for year in range(start.year, outcome_month.year)
                if date(year, outcome_month.month, 1) >= start
            ]
            if len(seasonal_months) < minimum_prior_seasons:
                prior_repairs += current_repairs
                continue
            baseline = sum(
                repair_counts.get((shop, zip_code, prior_month), 0)
                for prior_month in seasonal_months
            ) / len(seasonal_months)
            actual = repair_counts.get((shop, zip_code, outcome_month), 0)
            threshold = max(2, math.floor(baseline) + 1)
            types = signals.get((zip_code, exposure_month), ())
            case = {
                "shop": shop,
                "zip": zip_code,
                "exposure_month": exposure_month.isoformat(),
                "outcome_month": outcome_month.isoformat(),
                "baseline": baseline,
                "actual": actual,
                "follow_through": actual >= threshold,
                "prior_repairs": prior_repairs,
            }
            evaluated_shops.add(shop)
            evaluated_zips.add(zip_code)
            if types:
                signal_cases.append(case)
                by_signal["+".join(types)].append(case)
                signal_by_exposure[exposure_tier(prior_repairs)].append(case)
            else:
                control_cases.append(case)
                control_by_exposure[exposure_tier(prior_repairs)].append(case)
            prior_repairs += current_repairs

    overall = compare(signal_cases, control_cases)
    return {
        "method": {
            "signal": "Final NCEI ZIP-month with tornado, hail >= 1 inch, or wind >= 50 knots (about 58 mph)",
            "outcome": "Next calendar month's repair arrivals exceed the prior same-month seasonal average and total at least two",
            "baseline": f"Only prior years; at least {minimum_prior_seasons} prior same-calendar-month observations",
            "scope": "A source shop/ZIP enters only after its first observed repair; the outcome month must be complete for that source shop",
        },
        "coverage": {
            "input_repair_rows": len(repair_rows),
            "valid_repair_rows_from_2016": valid_repairs,
            "input_high_signal_zip_months": len(weather_rows),
            "loaded_boundary_zips": len(boundary_zips),
            "evaluated_source_shops": len(evaluated_shops),
            "evaluated_customer_zips": len(evaluated_zips),
        },
        **overall,
        "by_signal": {
            key: summarize(cases)
            for key, cases in sorted(by_signal.items(), key=lambda item: item[0])
        },
        "by_prior_zip_repairs": {
            tier: compare(
                signal_by_exposure.get(tier, []), control_by_exposure.get(tier, [])
            )
            for tier in (
                "0-4 prior repairs",
                "5-9 prior repairs",
                "10-24 prior repairs",
                "25+ prior repairs",
            )
        },
        "limitations": [
            "This is a historical proxy for the 72-hour preliminary SPC queue, not a validation of live notifications.",
            "ZIP-month weather timing cannot isolate a 1-4 week response or prove causation.",
            "A no-follow-through case means no unusual PSG-observed repair arrival next month; it does not prove the weather report was false.",
            "Repair capture varies by source shop and market, and insurer claim counts are unavailable.",
        ],
    }


def self_test() -> dict[str, Any]:
    repairs = []
    for year, count in [(2020, 1), (2021, 1), (2022, 1), (2023, 3), (2024, 1)]:
        repairs.extend(
            {
                "source_shop_key": "PS1",
                "customer_zip": "12345",
                "arrival_date": f"{year}-01-{day + 1:02d}",
            }
            for day in range(count)
        )
    repairs.append(
        {
            "source_shop_key": "PS1",
            "customer_zip": "12345",
            "arrival_date": "2025-03-01",
        }
    )
    weather = [
        {
            "zip": "12345",
            "month": "2022-12-01",
            "tornado_events": 0,
            "max_hail_size": 1.25,
            "max_wind_speed": None,
        },
        {
            "zip": "12345",
            "month": "2023-12-01",
            "tornado_events": 1,
            "max_hail_size": None,
            "max_wind_speed": None,
        },
    ]
    result = evaluate(repairs, weather, {"12345"})
    assert result["signal"]["cases"] == 2
    assert result["signal"]["follow_through_cases"] == 1
    assert result["signal"]["no_follow_through_cases"] == 1
    assert result["by_signal"]["hail"]["follow_through_cases"] == 1
    assert result["by_signal"]["tornado"]["follow_through_cases"] == 0
    assert result["by_prior_zip_repairs"]["0-4 prior repairs"]["signal"]["cases"] == 1
    assert result["by_prior_zip_repairs"]["5-9 prior repairs"]["signal"]["cases"] == 1
    return {"self_test": "passed", "signal_cases": 2}


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.self_test:
        return self_test()
    if not args.env_file:
        raise ValueError("--env-file is required unless --self-test is used")
    env = load_env(Path(args.env_file))
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    if args.project_id != PROJECT_ID or args.project_id not in url:
        raise ValueError("Supabase URL does not match the approved project")

    repairs = fetch_rows_paged(
        url,
        key,
        "collision_repair_facts",
        {
            "select": "source_shop_key,customer_zip,arrival_date",
            "arrival_date": f"gte.{WEATHER_START.isoformat()}",
            "customer_zip": "not.is.null",
            "order": "source_record_hash.asc",
        },
    )
    weather = fetch_rows_paged(
        url,
        key,
        "storm_zip_monthly",
        {
            "select": "zip,month,tornado_events,max_hail_size,max_wind_speed",
            "month": f"gte.{WEATHER_START.isoformat()}",
            "or": "(tornado_events.gt.0,max_hail_size.gte.1,max_wind_speed.gte.50)",
            "order": "zip.asc,month.asc",
        },
    )
    boundaries = fetch_rows_paged(
        url,
        key,
        "zipcode_boundaries",
        {"select": "zip_code", "order": "zip_code.asc"},
    )
    return evaluate(
        repairs,
        weather,
        {str(row["zip_code"]) for row in boundaries},
        args.minimum_prior_seasons,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file")
    parser.add_argument("--project-id", default=PROJECT_ID)
    parser.add_argument("--minimum-prior-seasons", type=int, default=MIN_PRIOR_SEASONS)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    try:
        print(json.dumps(run(parse_args()), indent=2, sort_keys=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise
