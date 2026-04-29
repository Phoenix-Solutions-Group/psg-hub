"""Build marketing intelligence aggregates from the full HF accident dataset."""

from __future__ import annotations

import json
import math
import os
import re
import urllib.request
from collections import Counter
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq


HF_DATASET_REPO = "yuvidhepe/us-accidents-updated"
HF_DATASET_SPLIT = "default/train"
HF_EXPECTED_ROW_COUNT = 7_728_394
HF_PARQUET_BASE_URL = (
    "https://huggingface.co/datasets/"
    f"{HF_DATASET_REPO}/resolve/refs%2Fconvert%2Fparquet/{HF_DATASET_SPLIT}"
)
PARQUET_URLS = [
    f"{HF_PARQUET_BASE_URL}/0000.parquet",
    f"{HF_PARQUET_BASE_URL}/0001.parquet",
    f"{HF_PARQUET_BASE_URL}/0002.parquet",
    f"{HF_PARQUET_BASE_URL}/0003.parquet",
    f"{HF_PARQUET_BASE_URL}/0004.parquet",
    f"{HF_PARQUET_BASE_URL}/0005.parquet",
    f"{HF_PARQUET_BASE_URL}/0006.parquet",
]

COLUMNS = [
    "Zipcode",
    "Start_Time",
    "Severity",
    "Weather_Condition",
    "Precipitation(in)",
    "Distance(mi)",
]

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(os.environ.get("PSG_HF_CACHE_DIR", "/tmp/psg-us-accidents"))
OUTPUT = ROOT / "src" / "lib" / "marketingIntelligenceData.ts"
WEATHER_TERMS = re.compile(r"rain|snow|storm|hail|sleet|fog|thunder", re.I)


def normalize_zip(value: object) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None

    match = re.search(r"\d{5}", str(value))
    return match.group(0) if match else None


def score(value: float, max_value: float, floor: int = 35) -> int:
    if max_value <= 0:
        return floor
    return round(floor + ((value / max_value) * (100 - floor)))


def download_parquet_files() -> list[Path]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    paths = []

    for url in PARQUET_URLS:
        path = CACHE_DIR / url.rsplit("/", 1)[-1]
        if not path.exists():
            print(f"Downloading {url}")
            urllib.request.urlretrieve(url, path)
        paths.append(path)

    return paths


def iter_batches(paths: list[Path]):
    for path in paths:
        parquet = pq.ParquetFile(path)
        for batch in parquet.iter_batches(batch_size=200_000, columns=COLUMNS):
            yield batch.to_pandas()


def build_data() -> dict:
    zip_counts: Counter[str] = Counter()
    hour_counts: Counter[int] = Counter()
    severity_counts: Counter[int] = Counter()
    weather_related = 0
    total_rows = 0
    total_distance = 0.0
    distance_rows = 0

    for batch in iter_batches(download_parquet_files()):
        total_rows += len(batch)

        zips = batch["Zipcode"].map(normalize_zip)
        zip_counts.update(zips.dropna())

        start_times = pd.to_datetime(batch["Start_Time"], errors="coerce")
        hour_counts.update(start_times.dt.hour.dropna().astype(int))

        severity = pd.to_numeric(batch["Severity"], errors="coerce")
        severity_counts.update(severity.dropna().astype(int))

        weather = batch["Weather_Condition"].fillna("")
        precipitation = pd.to_numeric(batch["Precipitation(in)"], errors="coerce").fillna(0)
        weather_related += int((weather.str.contains(WEATHER_TERMS) | (precipitation > 0)).sum())

        distance = pd.to_numeric(batch["Distance(mi)"], errors="coerce")
        total_distance += float(distance.dropna().sum())
        distance_rows += int(distance.notna().sum())

    top_zips = zip_counts.most_common(5)
    max_zip_count = top_zips[0][1] if top_zips else 0
    severe_total = severity_counts[3] + severity_counts[4]
    severe_rate = severe_total / total_rows if total_rows else 0
    weather_rate = weather_related / total_rows if total_rows else 0

    opportunity = []
    for zip_code, accidents in top_zips:
        repair_demand = score(accidents, max_zip_count)
        shop_coverage = max(22, 82 - round((accidents / max_zip_count) * 42))
        paid_search = min(100, round((repair_demand * 0.72) + ((100 - shop_coverage) * 0.28)))
        opportunity.append({
            "zip": zip_code,
            "accidents": accidents,
            "repairDemand": repair_demand,
            "shopCoverage": shop_coverage,
            "paidSearch": paid_search,
        })

    labels = [("12a", [0, 1, 2]), ("3a", [3, 4, 5]), ("6a", [6, 7, 8]),
              ("9a", [9, 10, 11]), ("12p", [12, 13, 14]), ("3p", [15, 16, 17]),
              ("6p", [18, 19, 20]), ("9p", [21, 22, 23])]
    max_daypart = max((sum(hour_counts[h] for h in hours) for _, hours in labels), default=1)
    daypart = []
    for label, hours in labels:
        claims = sum(hour_counts[h] for h in hours)
        claim_score = score(claims, max_daypart, floor=20)
        daypart.append({
            "time": label,
            "claims": claim_score,
            "search": max(10, round(claim_score * 0.9)),
        })

    accident_density = 92 if total_rows > 7_000_000 else 78
    weather_score = round(45 + min(weather_rate * 200, 45))
    severity_score = round(50 + min(severe_rate * 160, 40))
    proximity_score = opportunity[0]["shopCoverage"] if opportunity else 60
    gap_score = round(100 - proximity_score)

    return {
        "metadata": {
            "source": HF_DATASET_REPO,
            "split": HF_DATASET_SPLIT,
            "rowCount": total_rows,
            "expectedRowCount": HF_EXPECTED_ROW_COUNT,
            "weatherRelatedCount": weather_related,
            "severeAccidentRate": round(severe_rate * 100, 1),
            "weatherRelatedRate": round(weather_rate * 100, 1),
            "averageDistanceMiles": round(total_distance / distance_rows, 2) if distance_rows else 0,
        },
        "metrics": {
            "targetableAccidentDemand": sum(count for _, count in top_zips),
            "coverageGap": round(sum(100 - row["shopCoverage"] for row in opportunity) / len(opportunity)),
            "bestNextChannel": "Paid search",
        },
        "opportunityByZip": opportunity,
        "daypartDemand": daypart,
        "marketMix": [
            {"channel": "Paid search", "score": opportunity[0]["paidSearch"] if opportunity else 90},
            {"channel": "Tow partner", "score": min(100, round(severity_score + 10))},
            {"channel": "Geofenced display", "score": min(100, round(accident_density * 0.82))},
            {"channel": "Local service ads", "score": min(100, round((accident_density + gap_score) / 2))},
            {"channel": "Weather trigger", "score": weather_score},
        ],
        "customerSignals": [
            {"signal": "Accident density", "current": accident_density, "target": 90},
            {"signal": "Shop coverage", "current": proximity_score, "target": 80},
            {"signal": "Severity mix", "current": severity_score, "target": 75},
            {"signal": "Weather risk", "current": weather_score, "target": 72},
            {"signal": "Coverage gap", "current": gap_score, "target": 68},
        ],
        "segments": [
            {
                "name": "High-intent collision searches",
                "audience": f"Drivers in the top accident ZIPs: {', '.join(zip_code for zip_code, _ in top_zips[:3])}.",
                "action": "Increase paid search coverage during the highest accident dayparts.",
                "impact": f"{sum(count for _, count in top_zips[:3]):,} priority accidents",
            },
            {
                "name": "Tow and referral partner zones",
                "audience": "ZIPs with high accident volume and inferred shop coverage gaps.",
                "action": "Use the top ZIP list to prioritize tow, carrier, and DRP partner outreach.",
                "impact": f"{round(sum(100 - row['shopCoverage'] for row in opportunity) / len(opportunity))}% coverage gap",
            },
            {
                "name": "Weather-triggered outreach",
                "audience": "Markets where rain, snow, fog, or precipitation is present in accident records.",
                "action": "Launch same-day paid search and social bursts after severe weather alerts.",
                "impact": f"{weather_related:,} weather-linked accidents",
            },
        ],
    }


def write_typescript(data: dict) -> None:
    payload = json.dumps(data, indent=2)
    OUTPUT.write_text(
        "export const marketingIntelligenceData = "
        + payload
        + " as const\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    result = build_data()
    write_typescript(result)
    print(f"Wrote {OUTPUT}")
    print(json.dumps(result["metadata"], indent=2))
