"""BigQuery table schema definitions for all reference tables."""

from google.cloud import bigquery

ZIP_REFERENCE_SCHEMA = [
    bigquery.SchemaField("zip_code", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state_fips", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("county_fips", "STRING", mode="REQUIRED"),
]

ZCTA_ZIP_SCHEMA = [
    bigquery.SchemaField("zip_code", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("reporting_year", "INTEGER"),
    bigquery.SchemaField("zip_type", "STRING"),
    bigquery.SchemaField("city_name", "STRING"),
    bigquery.SchemaField("state_name", "STRING"),
    bigquery.SchemaField("state_abbr", "STRING"),
    bigquery.SchemaField("enc_zip", "STRING"),
    bigquery.SchemaField("zcta", "STRING"),
]

STATE_REFERENCE_SCHEMA = [
    bigquery.SchemaField("state_fips", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state_abbr", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state_name", "STRING", mode="REQUIRED"),
]

COUNTY_REFERENCE_SCHEMA = [
    bigquery.SchemaField("county_fips", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state_abbr", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("county_name", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state_fips", "STRING", mode="REQUIRED"),
]

ZIPCODE_BOUNDARIES_STAGING_SCHEMA = [
    bigquery.SchemaField("zip_code", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state_fips", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("boundary_geojson", "STRING", mode="REQUIRED"),
]

ACCIDENTS_SCHEMA = [
    bigquery.SchemaField("id", "STRING"),
    bigquery.SchemaField("source", "STRING"),
    bigquery.SchemaField("severity", "INTEGER"),
    bigquery.SchemaField("start_time", "TIMESTAMP"),
    bigquery.SchemaField("end_time", "TIMESTAMP"),
    bigquery.SchemaField("start_lat", "FLOAT64"),
    bigquery.SchemaField("start_lng", "FLOAT64"),
    bigquery.SchemaField("end_lat", "FLOAT64"),
    bigquery.SchemaField("end_lng", "FLOAT64"),
    bigquery.SchemaField("distance_mi", "FLOAT64"),
    bigquery.SchemaField("description", "STRING"),
    bigquery.SchemaField("street", "STRING"),
    bigquery.SchemaField("city", "STRING"),
    bigquery.SchemaField("county", "STRING"),
    bigquery.SchemaField("state", "STRING"),
    bigquery.SchemaField("zipcode", "STRING"),
    bigquery.SchemaField("country", "STRING"),
    bigquery.SchemaField("timezone", "STRING"),
    bigquery.SchemaField("airport_code", "STRING"),
    bigquery.SchemaField("weather_timestamp", "TIMESTAMP"),
    bigquery.SchemaField("temperature_f", "FLOAT64"),
    bigquery.SchemaField("wind_chill_f", "FLOAT64"),
    bigquery.SchemaField("humidity_pct", "FLOAT64"),
    bigquery.SchemaField("pressure_in", "FLOAT64"),
    bigquery.SchemaField("visibility_mi", "FLOAT64"),
    bigquery.SchemaField("wind_direction", "STRING"),
    bigquery.SchemaField("wind_speed_mph", "FLOAT64"),
    bigquery.SchemaField("precipitation_in", "FLOAT64"),
    bigquery.SchemaField("weather_condition", "STRING"),
    bigquery.SchemaField("amenity", "BOOLEAN"),
    bigquery.SchemaField("bump", "BOOLEAN"),
    bigquery.SchemaField("crossing", "BOOLEAN"),
    bigquery.SchemaField("give_way", "BOOLEAN"),
    bigquery.SchemaField("junction", "BOOLEAN"),
    bigquery.SchemaField("no_exit", "BOOLEAN"),
    bigquery.SchemaField("railway", "BOOLEAN"),
    bigquery.SchemaField("roundabout", "BOOLEAN"),
    bigquery.SchemaField("station", "BOOLEAN"),
    bigquery.SchemaField("stop", "BOOLEAN"),
    bigquery.SchemaField("traffic_calming", "BOOLEAN"),
    bigquery.SchemaField("traffic_signal", "BOOLEAN"),
    bigquery.SchemaField("turning_loop", "BOOLEAN"),
    bigquery.SchemaField("sunrise_sunset", "STRING"),
    bigquery.SchemaField("civil_twilight", "STRING"),
    bigquery.SchemaField("nautical_twilight", "STRING"),
    bigquery.SchemaField("astronomical_twilight", "STRING"),
]

DENSITY_TABLE_SCHEMA = [
    bigquery.SchemaField("zip", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("state", "STRING"),
    bigquery.SchemaField("year", "INTEGER"),
    bigquery.SchemaField("severity_1_count", "INTEGER"),
    bigquery.SchemaField("severity_2_count", "INTEGER"),
    bigquery.SchemaField("severity_3_count", "INTEGER"),
    bigquery.SchemaField("severity_4_count", "INTEGER"),
    bigquery.SchemaField("total_count", "INTEGER"),
    bigquery.SchemaField("weather_related_count", "INTEGER"),
]
