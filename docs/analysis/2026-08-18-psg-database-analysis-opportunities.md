# PSG Supabase Data Analysis Opportunities

**Project:** `gylkkzmcmbdftxieyabw` (`localreach`)
**Assessment date:** 2026-08-18
**Scope:** Entire `public` schema plus the 2024 NHTSA import completed during this assessment

## Executive conclusion

The database is already strong enough for market-demand scoring, collision-pattern analysis, geographic opportunity mapping, customer-experience trends, repair-revenue benchmarking, and pipeline reporting. The best immediate PSG product is a ZIP-level collision opportunity model combining crashes, storms, vehicle mix, income, competitor density, and shop proximity.

The database is not yet reliable for causal campaign ROI or closed-loop customer journey analysis. Those analyses are blocked by missing identifiers between mail sends, surveys, repair orders, reviews, and shops—not by a lack of raw data.

## 2024 official accident data added

The import uses official NHTSA archives rather than third-party mirrors:

- [FARS](https://www.nhtsa.gov/research-data/fatality-analysis-reporting-system-fars): census of fatal motor-vehicle crashes.
- [CRSS](https://www.nhtsa.gov/crash-data-systems/crash-report-sampling-system): probability sample for national estimates of police-reported crashes.
- [CISS](https://www.nhtsa.gov/crash-data-systems/crash-investigation-sampling-system): detailed probability sample focused on crashworthiness and investigated vehicles.

| System    | Crash rows | Vehicle rows | Person rows | Correct interpretation                             |
| --------- | ---------: | -----------: | ----------: | -------------------------------------------------- |
| FARS 2024 |     36,297 |       56,011 |      88,326 | Direct counts; 39,254 fatalities                   |
| CRSS 2024 |     51,658 |       90,641 |     126,159 | Multiply by `sample_weight` for national estimates |
| CISS 2024 |      5,290 |        9,212 |      10,237 | Use weights; detailed vehicle/damage analysis      |
| **Total** | **93,245** |  **155,864** | **224,722** | **473,831 imported rows**                          |

All catalog counts equal actual table counts. Every crash row has the correct weight semantics. FARS has 36,127 geocoded crash rows; CRSS and CISS intentionally suppress exact location because they are national samples. Archive SHA-256 hashes and source URLs are stored in `nhtsa_dataset_sources`.

The import is analysis-ready rather than a byte-for-byte archive copy. It retains the core crash, vehicle, person, sampling, collision, injury, damage, make/model, tow, rollover, fire, road, weather, restraint, airbag, and CISS crush/delta-V fields. Specialized archival helper tables remain available from NHTSA if a future study requires them.

## Database inventory

| Area                 | Current evidence                                                                                                                                  | What it supports                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Schema               | 210 public tables, 7 views, 311 foreign keys, about 9.7 GB                                                                                        | Cross-domain analysis with a substantial relational foundation                                       |
| Security             | 209 of 210 public tables have RLS enabled                                                                                                         | Tenant-aware analysis; new NHTSA tables are service-role-only by design                              |
| Customer core        | 15 shops, 6 locations; only 3 shops geocoded                                                                                                      | Shop reporting, but location enrichment is incomplete                                                |
| Surveys              | 339,026 responses, 84,953 comments, 2012-01-04 through 2026-08-05                                                                                 | CSI, recommendation, referral, complaint, and text analysis                                          |
| Reviews              | 393 review items; 15 sentiment rows                                                                                                               | Reputation trends; classification coverage is only 3.8%                                              |
| Repair orders        | 327,313 PII-minimized FileMaker facts across 199 source shop keys; $1.652B recorded repair value; 3,420 facts mapped to the current pilot company | Shop, insurer-label, ZIP, vehicle, seasonality, cycle-time, payment-mix, value, and quality analysis |
| Direct mail          | 753,648 sends, 2020-01-02 through 2026-08-12                                                                                                      | Volume, cadence, suppression, and cohort analysis                                                    |
| Pipeline             | 329 Pipedrive deals; 10 open, 243 won; $2.24M recorded value                                                                                      | Funnel, velocity, owner, stage, and forecast analysis                                                |
| Nationwide accidents | 6,666,012 represented in ZIP rollups across 24,015 ZIPs and 49 states, 2016-2023                                                                  | Historical collision demand and seasonality                                                          |
| Chicago crashes      | 440,333 crashes, 96,220 injuries, 518 fatalities, 2022-2025                                                                                       | Current local daypart, severity, cause, and micro-market analysis                                    |
| NHTSA 2024           | 473,831 crash/vehicle/person rows                                                                                                                 | Current national fatality, collision-mix, and crashworthiness analysis                               |
| Storms               | 653,801 events, 2016-2025; $245.94B recorded property damage                                                                                      | Hail/wind/weather repair-demand signals                                                              |
| EV registrations     | 244,310 rows, 335,497 represented vehicles, 9,201 ZIPs                                                                                            | EV market readiness, certification, and campaign targeting                                           |
| Competitors          | 36,285 body shops, all geocoded; 35,408 rated                                                                                                     | White-space, saturation, proximity, and reputation benchmarking                                      |
| Knowledge            | 216 documents and 4,519 chunks                                                                                                                    | RAG/search; all 216 metadata objects are currently empty                                             |
| Analytics snapshots  | 937 rows, 11 shops, 2026-05-01 through 2026-08-18                                                                                                 | Recent shop KPI trend reporting                                                                      |

Planner statistics mark 136 tables as empty or not yet analyzed. That is a signal to inventory dormant modules, not proof that every one of those tables is empty.

## Analyses PSG can perform now

| Priority | Analysis                            | Method                                                                                                          | Readiness                               | Practical output                                                       |
| -------: | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
|        1 | Collision market opportunity by ZIP | Normalize crashes, injury crashes, storms, registered vehicles, income, competitors, and distance to a PSG shop | High                                    | Ranked expansion/advertising ZIPs with reason codes                    |
|        2 | National collision mix              | Weighted CRSS collision, weather, severity, daypart, body class, and tow analysis                               | High                                    | Content topics, paid-search themes, and market benchmarks              |
|        3 | Fatal-crash geographic risk         | FARS state/coordinate trends joined to PSG markets                                                              | High                                    | Safety content, seasonal messaging, and geographic demand context      |
|        4 | Vehicle and repair-complexity mix   | CISS make/model/body class, crush, delta-V, tow, rollover, restraint, and injury analysis                       | High                                    | OEM/EV capability priorities and estimator/technician training signals |
|        5 | Shop CSI and complaint intelligence | Survey scores, recommendation flags, comments, and review text by shop/month                                    | Medium                                  | Leading indicators, complaint themes, and recovery queues              |
|        6 | Repair revenue benchmarking         | Repair amount, pay type, status, customer, and shop cohorts                                                     | Medium                                  | ARO distribution, customer value, and revenue-mix benchmarks           |
|        7 | Competitor white-space analysis     | Body-shop density/rating plus collision and vehicle demand within drive-time or radius                          | High                                    | Prospecting territories and LocalReach page priorities                 |
|        8 | Storm-triggered campaigns           | Storm event/ZIP/month signals joined to customer ZIP and market scores                                          | High for targeting; low for causal lift | Timely hail/wind campaign audiences and forecasts                      |
|        9 | Sales pipeline forecast             | Deal stage, probability, owner, expected close, activity recency, and historical win rates                      | Medium                                  | Weighted forecast and stalled-deal alerts                              |
|       10 | Content/reputation learning loop    | Review/survey themes joined to content, recommendations, and knowledge chunks                                   | Medium-low                              | Evidence-backed content prompts and FAQ priorities                     |

## Example findings

### National collision mix

CRSS weights estimate about 6.18 million police-reported crashes in 2024. The largest categories in the imported sample are:

| Collision category                                                    | Sample rows | Weighted estimate | Weighted injuries |
| --------------------------------------------------------------------- | ----------: | ----------------: | ----------------: |
| First harmful event not a collision with another in-transport vehicle |      17,351 |         1,835,876 |           572,894 |
| Front-to-rear                                                         |      13,135 |         1,740,613 |           624,564 |
| Angle                                                                 |      12,325 |         1,416,869 |           801,215 |
| Same-direction sideswipe                                              |       5,681 |           827,131 |           130,540 |
| Front-to-front                                                        |       1,766 |           158,015 |           155,296 |

Interpretation: angle crashes produce a larger estimated injury burden than rear-end crashes despite lower estimated volume. That supports distinct content, safety, and repair-complexity segments instead of treating every collision lead identically.

```sql
-- CRSS is a probability sample: SUM(sample_weight), not COUNT(*), estimates crashes.
select collision_type,
       count(*) as sampled_crashes,
       round(sum(sample_weight)) as estimated_crashes,
       round(sum(sample_weight * injury_count)) as estimated_injuries
from public.nhtsa_crashes
where dataset_key = 'crss' and source_year = 2024
group by collision_type
order by estimated_crashes desc;
```

### Fatal-crash concentration

FARS records the most 2024 fatalities in Texas (4,160), California (3,876), Florida (3,138), North Carolina (1,619), and Georgia (1,403). These are direct census counts, not sample estimates.

```sql
select state, count(*) as fatal_crashes, sum(fatalities) as fatalities
from public.nhtsa_crashes
where dataset_key = 'fars' and source_year = 2024
group by state
order by fatalities desc;
```

### Crashworthiness and vehicle mix

CISS contains detailed make/model and physical crash indicators. Among makes with at least 25 sampled vehicles, the largest weighted counts include Ford (641,759), Toyota (622,404), Chevrolet (550,095), Honda (527,775), and Nissan (473,002). Their observed mean delta-V values are about 22-25 in the source unit after NHTSA unknown-value codes are removed.

```sql
-- Keep sample size beside weighted estimates; small CISS groups have high uncertainty.
select make,
       count(*) as sampled_vehicles,
       round(sum(sample_weight)) as weighted_vehicles,
       round(avg(delta_v)::numeric, 1) as avg_delta_v,
       count(*) filter (where details ? 'max_crush_cm') as crush_measured
from public.nhtsa_vehicles
where dataset_key = 'ciss' and source_year = 2024 and make is not null
group by make
having count(*) >= 25
order by weighted_vehicles desc;
```

### Existing ZIP opportunity signal

The current `market_zip_latest_signal` is immediately usable, but its highest 2025 scores are all Chicago ZIPs. For example, 60639 scores 5,382 with 3,733 crashes and 563 injury crashes. Treat this as a Chicago implementation, not a finished national ranking.

## Blocking data gaps

1. **Closed-loop attribution:** zero survey responses and zero direct-mail records currently link to `repair_orders` by `repair_order_id`. Mail volume can be described, but campaign revenue lift cannot be credibly claimed.
2. **Shop identity coverage:** only 107,908 of 339,026 survey responses (31.8%) have `shop_id`; 3 of 15 Hub shops are geocoded. The FileMaker repair snapshot adds 199 usable source shop keys, but only PS177 is explicitly mapped; the other 198 must remain service-only until each company/shop mapping is approved.
3. **Review enrichment:** 15 of 393 reviews have sentiment records. Complete classification before cross-shop theme benchmarking.
4. **Knowledge metadata:** 216 documents exist, but none has populated metadata. Add client, market, effective date, evidence type, and sensitivity tags before using the corpus for governed AI analysis.
5. **Legacy accident provenance:** `accident_import_sources` is empty even though the raw partitioned accident table has about 7.7 million rows. Its schema strongly resembles a third-party US Accidents dataset with a non-commercial share-alike license, but that source has not been proven. Do not use the raw table in external/commercial outputs until provenance and license are confirmed. The official NHTSA tables do not have that ambiguity.
6. **Time/geography discontinuity:** nationwide ZIP accident rollups end in 2023; 2024 FARS is current but only covers fatal crashes. CRSS and CISS support national estimation but not local ZIP reporting. Continue official state/local crash ingestion for PSG markets.
7. **Sampling uncertainty:** CRSS/CISS point estimates need sample design, variance, or replicate-weight treatment for publication-grade confidence intervals. Use unweighted sample sizes as a suppression rule for small cells.

## Security and performance findings

- The four new NHTSA tables have RLS enabled with no user policies. This intentionally keeps them service-role-only until PSG chooses an app access model. Supabase reports this as informational: [RLS enabled with no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- The collision targeting view now uses invoker security and is service-role-only;
  the database advisor reports no remaining `SECURITY DEFINER` view errors. Keep
  future analysis views on the same boundary: [security-definer view guidance](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).
- The advisor also flags `spatial_ref_sys` for missing RLS. That is PostGIS reference data, so evaluate it as extension-managed infrastructure rather than a tenant table.
- The performance advisor reports 37 warnings across the existing database, primarily overlapping permissive RLS policies. These are not caused by the NHTSA import.
- Use `accident_density`, `market_zip_latest_signal`, and other rollups for dashboards rather than scanning the 7.7-million-row accident partitions. Use `nhtsa_crashes_location_idx` for FARS radius queries and keep dataset/year filters on all NHTSA queries.
- The new injury and location indexes are reported as unused immediately after creation; that is expected before application traffic begins.

## Recommended execution order

1. Build a governed ZIP opportunity score with transparent component weights and freshness dates.
2. Repair canonical shop/location mapping and geocode the remaining 12 shops.
3. Backfill `repair_order_id` on mail and survey records using source IDs plus explicit confidence and exception tables.
4. Complete review sentiment/theme classification and knowledge metadata.
5. Add official state crash feeds only for active PSG markets; do not ingest all states speculatively.
6. Add CRSS/CISS variance or replicate-weight logic before publishing confidence intervals or making high-stakes comparative claims.

With those linkage fixes, the same database can support true channel ROI, customer lifetime value, retention propensity, campaign incrementality, and shop-level demand forecasting. Without them, those outputs should remain descriptive rather than causal.
