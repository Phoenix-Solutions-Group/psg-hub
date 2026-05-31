# Wallace — Landing Page Remap (Live-Crawl Verified)
**Date:** 2026-05-20 | **CID:** 6048611995
**Source:** live crawl of https://wallacecollisionrepair.com + Google Ads API pull of `ad_group_ad.final_urls` + `policy_summary.approval_status`

## Correction to 2026-05-19 version

Prior table was built from `sitemap/wallacecollisionrepair.com - internal.csv` — that CSV was incomplete. Live crawl confirms the site has dedicated OEM pages. Most ads are pointing at valid URLs already.

## Live Q2 ad state (API, 2026-05-20)

| Ad ID | Campaign | Ad group | final_url | Approval | URL status (live) |
|---|---|---|---|---|---|
| 807976621120 | Brand_2026Q2 | Brand Terms | `/` | APPROVED | ✅ 200 |
| 807942855741 | LocalCollision_2026Q2 | Collision Repair | `/collision-repair/` | APPROVED | ✅ 200 |
| 807976627198 | LocalCollision_2026Q2 | Body Shop | `/collision-repair/` | APPROVED | ✅ 200 |
| 807976628086 | LocalCollision_2026Q2 | Competitor Conquest | `/collision-repair/` | APPROVED | ✅ 200 |
| 808059224855 | LocalCollision_2026Q2 | Estimate and Insurance | `/collision-repair/` | APPROVED | ✅ 200 |
| 807976652800 | LocalCollision_2026Q2 | Paint and Dent | `/collision-repair/` | APPROVED | ✅ 200 |
| 807976782880 | TeslaApproved_2026Q2 | Tesla Approved Collision | `/tesla-approved/` | APPROVED | ✅ 200 |
| 807976610098 | JLRCertified_2026Q2 | JLR Certified Collision | `/jaguar-land-rover-certified/` | **DISAPPROVED** | ❌ 404 |
| 808059274238 | ToyotaCertified_2026Q2 | Toyota Certified Collision | `/toyota-certified/` | **DISAPPROVED** | ❌ 404 |
| 808059274499 | ToyotaCertified_2026Q2 | Toyota Model Specific | `/toyota-certified/` | **DISAPPROVED** | ❌ 404 |
| 808059274550 | ToyotaCertified_2026Q2 | Toyota Dealer Conquest | `/toyota-certified/` | **DISAPPROVED** | ❌ 404 |

**Net:** 7 of 11 ads have valid URLs and just need to be unpaused. 1 JLR ad needs URL swap. 3 Toyota ads need a bridge URL (no Toyota page exists yet).

## Verified site OEM pages

| OEM | Page | Status |
|---|---|---|
| Tesla | `/tesla-approved/` | ✅ exists, H1 "Tesla Approved Body Shop" |
| Tesla | `/certifications/tesla/` | ✅ exists (alt) |
| BMW | `/bmw-certified-collision-repair-center/` | ✅ exists |
| JLR | `/jlr-certified-repair-center/` | ✅ exists, H1 "...Local JLR Certified Repair Center" |
| Rivian | `/certifications/rivian/` | ✅ exists, H1 "Rivian Certified Collision Repair" |
| Toyota | `/certifications/toyota/` | ❌ 404 |
| Toyota | `/toyota-certified/` | ❌ 404 |
| Generic | `/collision-repair/` | ✅ exists, H1 "Collision Repair Services" |
| Generic | `/certifications/` | ✅ exists, OEM logo hub |

## Proposed remap (only 2 changes)

| # | Ad ID | Ad group | Current URL | Proposed URL | Why |
|---|---|---|---|---|---|
| R1 | 807976610098 | JLR Certified Collision | `/jaguar-land-rover-certified/` (404) | `/jlr-certified-repair-center/` | Real JLR cert page exists at this slug |
| R2 | 808059274238 | Toyota Certified Collision | `/toyota-certified/` (404) | `/repair-estimate/` | No Toyota cert page exists; bridge to conversion page until site team ships `/certifications/toyota/`. |
| R3 | 808059274499 | Toyota Model Specific | `/toyota-certified/` (404) | `/repair-estimate/` | Same |
| R4 | 808059274550 | Toyota Dealer Conquest | `/toyota-certified/` (404) | `/repair-estimate/` | Same |

After remap, Google re-crawls and re-evaluates within ~1 business day. Toyota ads will likely flip APPROVED but with BELOW_AVERAGE landing-page experience until site team ships `/certifications/toyota/`.

## Toyota long-term

Site team should add `/certifications/toyota/` following the same template as `/certifications/rivian/` and `/certifications/tesla/`. Once it ships, repoint R2 and R3 to it. Keep R4 (conquest) on `/start-estimate/`.

## Alternative for Toyota bridge

If `/certifications/` hub feels wrong, alternatives:
- `/collision-repair/` — generic but APPROVED, has Toyota in OEM logo list
- `/start-estimate/` — conversion-intent, lower QS but bidder optimizes on conversions anyway
- Hold Toyota paused — drop 3 ads + ~$15/day budget out of relight

Default plan uses `/certifications/` for the 2 cert-intent ad groups and `/start-estimate/` for the conquest ad group.

## Execution order

1. `add_oem_negatives` — 315 negatives across 7 OEM campaigns. Must run before any relight or the historical $278/30d waste pattern fires again.
2. `remap_q2_final_urls` — fix R1–R4.
3. `unpause_q2_ads` — 11 RSAs PAUSED → ENABLED.
4. `enable_brand_campaign` — Brand_2026Q2 live, $7→$15/d, TIS→TARGET_SPEND, +3 EXACT.
5. `clean_smart_bidding_signal` — qualify_lead MANY→ONE_PER_CLICK; drop Smart-call from conv metric.

Audit log JSON written to `apps/ads/logs/` after each `--execute`.
