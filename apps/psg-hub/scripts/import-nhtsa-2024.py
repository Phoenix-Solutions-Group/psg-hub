#!/usr/bin/env python3
"""Import analysis-ready 2024 FARS, CRSS, and CISS records into Supabase."""

import argparse
import csv
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path

PROJECT_REF = "gylkkzmcmbdftxieyabw"
SOURCES = {
    "fars": ("https://static.nhtsa.gov/nhtsa/downloads/FARS/2024/National/FARS2024NationalCSV.zip", "Fatality Analysis Reporting System", "Fatal-crash census", "Census of fatal motor-vehicle crashes"),
    "crss": ("https://static.nhtsa.gov/nhtsa/downloads/CRSS/2024/CRSS2024CSV.zip", "Crash Report Sampling System", "National police-reported crash estimates", "Probability sample; use sample_weight"),
    "ciss": ("https://static.nhtsa.gov/nhtsa/downloads/CISS/2024/CISS_2024_CSV_files.zip", "Crash Investigation Sampling System", "Detailed crashworthiness estimates", "Probability sample; use sample_weight"),
}


def value(row, key):
    text = (row.get(key) or "").strip()
    return text or None


def integer(row, key, low=None, high=None):
    try:
        number = int(float(value(row, key)))
    except (TypeError, ValueError):
        return None
    return number if (low is None or number >= low) and (high is None or number <= high) else None


def number(row, key):
    try:
        return float(value(row, key))
    except (TypeError, ValueError):
        return None


def bounded_number(row, key, low, high):
    result = number(row, key)
    return result if result is not None and low <= result <= high else None


def known_integer(row, key, name_key=None, high=None):
    label = (value(row, name_key) or "").lower() if name_key else ""
    if "unknown" in label or "not reported" in label:
        return None
    return integer(row, key, 0, high)


def details(**items):
    return {key: item for key, item in items.items() if item not in (None, "")}


def rows(archive, suffix):
    with zipfile.ZipFile(archive) as bundle:
        name = next(name for name in bundle.namelist() if name.lower().endswith(suffix.lower()))
        with bundle.open(name) as source:
            yield from csv.DictReader(line.decode("utf-8-sig", errors="replace") for line in source)


def crash_row(dataset, row):
    if dataset == "fars":
        return {"dataset_key": dataset, "source_year": 2024, "case_id": value(row, "ST_CASE"), "sample_weight": 1,
                "state": value(row, "STATENAME"), "month": integer(row, "MONTH", 1, 12), "day_of_week": value(row, "DAY_WEEKNAME"),
                "hour": integer(row, "HOUR", 0, 23), "vehicle_count": integer(row, "VE_TOTAL"), "person_count": integer(row, "PERSONS"),
                "fatalities": integer(row, "FATALS"), "max_severity": "Fatal", "collision_type": value(row, "MAN_COLLNAME"),
                "harmful_event": value(row, "HARM_EVNAME"), "weather": value(row, "WEATHERNAME"), "light_condition": value(row, "LGT_CONDNAME"),
                "roadway_context": value(row, "REL_ROADNAME"), "latitude": bounded_number(row, "LATITUDE", -90, 90),
                "longitude": bounded_number(row, "LONGITUD", -180, 180), "details": details(county=value(row, "COUNTYNAME"),
                city=value(row, "CITYNAME"), route=value(row, "ROUTENAME"), rural_urban=value(row, "RUR_URBNAME"))}
    if dataset == "crss":
        return {"dataset_key": dataset, "source_year": 2024, "case_id": value(row, "CASENUM"), "sample_weight": number(row, "WEIGHT"),
                "region": value(row, "REGIONNAME"), "urbanicity": value(row, "URBANICITYNAME"), "month": integer(row, "MONTH", 1, 12),
                "day_of_week": value(row, "DAY_WEEKNAME"), "hour": integer(row, "HOUR", 0, 23), "vehicle_count": integer(row, "VE_TOTAL"),
                "injury_count": known_integer(row, "NUM_INJ", "NUM_INJNAME", 90), "max_severity": value(row, "MAX_SEVNAME"), "collision_type": value(row, "MAN_COLLNAME"),
                "harmful_event": value(row, "HARM_EVNAME"), "weather": value(row, "WEATHERNAME"), "light_condition": value(row, "LGT_CONDNAME"),
                "roadway_context": value(row, "REL_ROADNAME"), "alcohol_involved": value(row, "ALCOHOLNAME"),
                "details": details(stratum=value(row, "STRATUMNAME"), work_zone=value(row, "WRK_ZONENAME"))}
    hour_text = value(row, "CRASHTIME")
    injured_values = (integer(row, "CINJURED", 0, 90), integer(row, "CNMINJURED", 0, 90))
    injured = sum(item for item in injured_values if item is not None)
    hour = int(hour_text.split(":")[0]) if hour_text and ":" in hour_text else None
    return {"dataset_key": dataset, "source_year": 2024, "case_id": value(row, "CASEID"), "sample_weight": number(row, "CASEWGT"),
            "month": integer(row, "CRASHMONTH", 1, 12), "day_of_week": value(row, "DAYOFWEEK"),
            "hour": hour if hour is not None and 0 <= hour <= 23 else None, "vehicle_count": integer(row, "VEHICLES"),
            "injury_count": injured, "collision_type": value(row, "MANCOLL"),
            "alcohol_involved": value(row, "ALCINV"), "details": details(case_number=value(row, "CASENUMBER"), category=value(row, "CATEGORY"),
            occupant_injury_severity=value(row, "CINJSEV"), nonmotorist_injury_severity=value(row, "CNMINJSEV"))}


def vehicle_row(dataset, row, vpic=None, crush=None):
    case = value(row, "ST_CASE" if dataset == "fars" else "CASENUM" if dataset == "crss" else "CASEID")
    vehicle_no = integer(row, "VEH_NO" if dataset != "ciss" else "VEHNO")
    if dataset in ("fars", "crss"):
        return {"dataset_key": dataset, "source_year": 2024, "case_id": case, "vehicle_no": vehicle_no,
                "sample_weight": 1 if dataset == "fars" else number(row, "WEIGHT"), "make": value(row, "VPICMAKENAME"),
                "model": value(row, "VPICMODELNAME"), "model_year": integer(row, "MOD_YEAR", 1885, 2026), "body_class": value(row, "VPICBODYCLASSNAME"),
                "occupants": known_integer(row, "NUMOCCS", "NUMOCCSNAME", 90), "towed": value(row, "TOWEDNAME"), "damage_extent": value(row, "DEFORMEDNAME"),
                "initial_impact": value(row, "IMPACT1NAME"), "rollover": value(row, "ROLLOVERNAME"), "fire": value(row, "FIRE_EXPNAME"),
                "speed_related": value(row, "SPEEDRELNAME"), "surface_condition": value(row, "VSURCONDNAME"),
                "injury_severity": value(row, "MAX_VSEVNAME"), "injured_occupants": known_integer(row, "NUM_INJV", "NUM_INJVNAME", 90),
                "details": details(harmful_event=value(row, "M_HARMNAME"), travel_speed=value(row, "TRAV_SPNAME"))}
    decoded = (vpic or {}).get((case, vehicle_no), {})
    damage = (crush or {}).get((case, vehicle_no), {})
    return {"dataset_key": dataset, "source_year": 2024, "case_id": case, "vehicle_no": vehicle_no, "sample_weight": number(row, "CASEWGT"),
            "make": value(decoded, "Make"), "model": value(decoded, "Model"), "model_year": integer(decoded, "ModelYear", 1885, 2026),
            "body_class": value(decoded, "BodyClass"), "towed": value(row, "TOWED"), "damage_extent": value(row, "DAMSEV"),
            "rollover": value(row, "ROLLTYPE"), "fire": None, "surface_condition": value(row, "SURFCOND"), "delta_v": bounded_number(row, "DVTOTAL", 0, 200),
            "injury_severity": value(row, "VINJSEV"), "injured_occupants": integer(row, "VINJURED", 0, 90),
            "details": details(damage_plane=value(row, "DAMPLANE"), crash_type=value(row, "CRASHTYPE"), max_crush_cm=damage.get("max_crush_cm"),
            fuel=value(decoded, "FuelTypePrimary"), drive_type=value(decoded, "DriveType"))}


def person_row(dataset, row):
    case = value(row, "ST_CASE" if dataset == "fars" else "CASENUM" if dataset == "crss" else "CASEID")
    if dataset in ("fars", "crss"):
        injury = value(row, "INJ_SEVNAME")
        return {"dataset_key": dataset, "source_year": 2024, "case_id": case, "vehicle_no": integer(row, "VEH_NO") or 0,
                "person_no": integer(row, "PER_NO"), "sample_weight": 1 if dataset == "fars" else number(row, "WEIGHT"),
                "person_type": value(row, "PER_TYPNAME"), "injury_severity": injury, "restraint_use": value(row, "REST_USENAME"),
                "air_bag": value(row, "AIR_BAGNAME"), "ejection": value(row, "EJECTIONNAME"), "hospitalized": value(row, "HOSPITALNAME"),
                "fatality": bool(injury and "fatal" in injury.lower()), "details": details(seat_position=value(row, "SEAT_POSNAME"))}
    death = value(row, "DEATH")
    return {"dataset_key": dataset, "source_year": 2024, "case_id": case, "vehicle_no": integer(row, "VEHNO") or 0,
            "person_no": integer(row, "OCCNO"), "sample_weight": number(row, "CASEWGT"), "person_type": value(row, "ROLE"),
            "injury_severity": value(row, "PARINJSEV"), "restraint_use": value(row, "BELTUSE"), "air_bag": value(row, "PARAIRBAG"),
            "hospitalized": value(row, "HOSPSTAY"), "fatality": death == "1", "details": details(mais=value(row, "MAIS"), iss=value(row, "ISS"))}


class Supabase:
    def __init__(self, key):
        self.base = f"https://{PROJECT_REF}.supabase.co/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                        "Prefer": "resolution=merge-duplicates,return=minimal"}

    def upsert(self, table, batch, conflict):
        request = urllib.request.Request(f"{self.base}/{table}?on_conflict={conflict}", json.dumps(batch).encode(), self.headers, method="POST")
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=120):
                    return
            except urllib.error.HTTPError as error:
                if attempt == 3:
                    raise RuntimeError(f"{table} import failed: {error.read().decode(errors='replace')}") from error
                time.sleep(2 ** attempt)


def import_stream(client, table, stream, conflict, workers=6, batch_size=750):
    pending, batch, total = set(), [], 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for item in stream:
            if not item.get("case_id"):
                continue
            batch.append(item)
            if len(batch) < batch_size:
                continue
            pending.add(pool.submit(client.upsert, table, batch, conflict)); total += len(batch); batch = []
            if len(pending) >= workers * 2:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in done: future.result()
        if batch:
            pending.add(pool.submit(client.upsert, table, batch, conflict)); total += len(batch)
        for future in pending: future.result()
    return total


def download_archives(directory, datasets):
    directory.mkdir(parents=True, exist_ok=True)
    result = {}
    for dataset in datasets:
        url = SOURCES[dataset][0]
        target = directory / f"{dataset}.zip"
        if not target.exists():
            urllib.request.urlretrieve(url, target)
        result[dataset] = target
    return result


def ciss_lookups(archive):
    vpic = {(value(row, "CASEID"), integer(row, "VEHNO")): row for row in rows(archive, "VPICDECODE.csv")}
    crush = {}
    for row in rows(archive, "CDC.csv"):
        key = (value(row, "CASEID"), integer(row, "VEHNO"))
        maximum = bounded_number(row, "CMAX", 0, 500)
        if maximum is not None:
            crush.setdefault(key, {})["max_crush_cm"] = max(maximum, crush.get(key, {}).get("max_crush_cm", maximum))
    return vpic, crush


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-dir", type=Path, default=Path(".cache/nhtsa-2024"))
    parser.add_argument("--dataset", action="append", choices=SOURCES)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        assert integer({"x": "99"}, "x", 0, 23) is None
        assert bounded_number({"x": "999"}, "x", 0, 200) is None
        assert known_integer({"x": "99", "x_name": "Unknown"}, "x", "x_name", 90) is None
        assert details(a=None, b="ok") == {"b": "ok"}
        assert crash_row("fars", {"ST_CASE": "1", "YEAR": "2024"})["sample_weight"] == 1
        print("checks passed")
        return
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is required")
    archives = download_archives(args.archive_dir, args.dataset or SOURCES)
    client = Supabase(key)
    counts = {}
    for dataset, archive in archives.items():
        url, system, scope, design = SOURCES[dataset]
        source = {"dataset_key": dataset, "source_year": 2024, "source_url": url, "system_type": system,
                  "analysis_scope": scope, "sample_design": design, "archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        client.upsert("nhtsa_dataset_sources", [source], "dataset_key,source_year")
        crash_suffix, vehicle_suffix, person_suffix = (("CRASH.csv", "GV.csv", "OCC.csv") if dataset == "ciss" else ("accident.csv", "vehicle.csv", "person.csv"))
        crash_count = import_stream(client, "nhtsa_crashes", (crash_row(dataset, row) for row in rows(archive, crash_suffix)), "dataset_key,source_year,case_id")
        vpic, crush = ciss_lookups(archive) if dataset == "ciss" else ({}, {})
        vehicle_count = import_stream(client, "nhtsa_vehicles", (vehicle_row(dataset, row, vpic, crush) for row in rows(archive, vehicle_suffix)), "dataset_key,source_year,case_id,vehicle_no")
        person_count = import_stream(client, "nhtsa_persons", (person_row(dataset, row) for row in rows(archive, person_suffix)), "dataset_key,source_year,case_id,vehicle_no,person_no")
        source.update(crash_rows=crash_count, vehicle_rows=vehicle_count, person_rows=person_count,
                      notes="Analysis-ready core tables; source archives contain additional specialized tables.")
        client.upsert("nhtsa_dataset_sources", [source], "dataset_key,source_year")
        counts[dataset] = [crash_count, vehicle_count, person_count]
        print(dataset, counts[dataset], flush=True)


if __name__ == "__main__":
    main()
