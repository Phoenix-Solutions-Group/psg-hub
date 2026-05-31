
**Date:** 2026-05-19 | **CID:** 6048611995 | **Score:** 35 / F

Three sections. Each item numbered. Reply with item numbers + what you want done.

---

## A. What is broken right now (live account state)

| #   | Issue                                                                                                                                                   | Evidence                                    | Blast radius                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A1  | All 11 Q2 RSAs are `ad_group_ad.status = PAUSED`                                                                                                        | `ad_group_ad` pull 2026-05-19               | Account dark on collision search since 2026-05-13                                                 |
| A2  | `GOOG_WAL_SRCH_Brand_2026Q2` campaign PAUSED at $7/d, `TARGET_IMPRESSION_SHARE`, 5 keywords loaded                                                      | `campaign.status = PAUSED`                  | Brand undefended on Search                                                                        |
| A3  | `qualify_lead` conv action (7194760257) still `MANY_PER_CLICK` + `include_in_conversions_metric = true`                                                 | `conversion_action` pull                    | Inflated lead count → Smart Bidding optimizes on duplicates                                       |
| A4  | `Smart campaign ad clicks to call` (7258748379) still `include_in_conversions_metric = true`                                                            | `conversion_action` pull                    | Smart-campaign signal bleeds into Search bidder via shared metric                                 |
| A5  | No shared negative-keyword lists. Only `Porsche` BRANDS shared set, 0 references                                                                        | `shared_set` pull                           | $278 / 30d historical waste on Tesla/JLR informational queries; will re-fire when Q2 RSAs unpause |
| A6  | Landing pages: 93% of rated keywords have `post_click_quality_score = BELOW_AVERAGE`. Ad-group URLs may not match Wallace site sitemap                  | `keyword_view` QS pull                      | Single biggest QS drag. Currently sending traffic to suboptimal pages                             |
| A7  | Legacy `Search General`, `Tesla Approved`, `JLR Certified Collision Repairs`, `Rivian Approved` still `positive_geo_target_type = PRESENCE_OR_INTEREST` | `campaign.geo_target_type_setting`          | Paused, so no current bleed. Bug re-emerges on any reactivation                                   |
| A8  | Legacy `Search General` still has `target_content_network = true` (Display on a Search campaign)                                                        | `campaign.network_settings`                 | Paused, but bug re-emerges on reactivation                                                        |
| A9  | 4 phone numbers across CALL assets, no clear call-tracking convention                                                                                   | per 5/18 audit, not re-checked today        | Call attribution unclear                                                                          |
| A10 | No PMax campaigns. Account historically generates 700+ conv/mo (eligible)                                                                               | campaign list                               | Missed growth channel                                                                             |
| A11 | `Wallace Ford of Kingsport Brand` Smart campaign ($9/d, $267/mo) runs in this collision-center CID                                                      | `campaign.advertising_channel_type = SMART` | Cross-business scope question; possible mis-attribution                                           |
| A12 | Daily budget capacity of $116/d sitting idle since 2026-05-13 (Q2 campaigns enabled, ads paused)                                                        | budget pull                                 | ~$700 in unspent allocation over 6 days                                                           |

---

## B. What is already built and ready to run

All scripts dry-run cleanly. None have been executed yet. Pre-built and in repo:

| # | Script | What it does |
|---|---|---|
| B1 | `ops/wallace/unpause_q2_ads.py` | Flips 11 RSAs PAUSED → ENABLED across LocalCollision_2026Q2 (5), TeslaApproved (1), JLRCertified (1), ToyotaCertified (3), Brand (1) |
| B2 | `ops/wallace/add_oem_negatives.py` | Adds 45 PHRASE negatives × 7 OEM campaigns = 315 ops. Blocks Tesla dealer/parts/service/model-year + JLR maintenance queries |
| B3 | `ops/wallace/enable_brand_campaign.py` | Brand_2026Q2 PAUSED→ENABLED, budget $7→$15/d, TARGET_IMPRESSION_SHARE → TARGET_SPEND ($1.50 ceiling), adds 3 EXACT keywords |
| B4 | `ops/wallace/clean_smart_bidding_signal.py` | `qualify_lead` MANY→ONE_PER_CLICK; `Smart ad clicks to call` drop from conv metric. (Goal-level demotions already done — script will no-op on those) |
| B5 | `ops/wallace/launch_2026q2_swap.py` | **Already executed 2026-05-13.** This is the script that caused A1 by enabling campaigns/ad groups but not ads |

**Proposed execute order:** B2 → B1 → B3 → B4
Reason: negatives must be in place before any ad relight, otherwise the same $278/mo waste pattern fires the moment Q2 starts serving.

---

## C. What still needs to be built / decided

| # | Item | Owner | Notes |
|---|---|---|---|
| C1 | Landing-page remap from `ops/wallace/sitemap/wallacecollisionrepair.com - internal.csv` | needs me to read CSV + propose mapping; needs you to approve final URL per ad group | Hits A6 (the biggest QS lever). 8 Q2 ad groups currently inheriting whatever final URLs the RSA carries — may not match sitemap intent |
| C2 | Geo fix script for legacy campaigns (A7) | needs build | 4 campaigns; flip `PRESENCE_OR_INTEREST` → `PRESENCE` |
| C3 | Display-network fix for `Search General` (A8) | needs build | One-line update to `network_settings.target_content_network` |
| C4 | Shared negative-keyword lists (A5 root fix) | needs build | 3 themed lists (Competitor / Jobs+Free / OEM-Parts+Service) + attach to enabled Search campaigns |
| C5 | Call-asset consolidation (A9) | needs client decision | Which phone number is authoritative? Then build asset re-attach script |
| C6 | PMax pilot (A10) | needs build, but blocked by C4 + Q2 running 14d | Brand exclusions, asset group, $40–60/d test |
| C7 | Wallace Ford of Kingsport Brand decision (A11) | client call | Keep / pause / migrate to separate CID |
| C8 | Customer Match list upload + remarketing exclusion | needs build + customer list export | Past-customer email list |
| C9 | Schema markup (LocalBusiness, AutoBodyShop) on landing pages | site team | Out of repo scope, brief needed |
| C10 | Mobile LCP improvement on the OEM landing pages | site team | G24 root cause; needs PSI run + dev work |
| C11 | RSA repair pass on the 4 legacy RSAs flagged POOR strength on 5/18 | needs build, but legacy campaigns paused so low urgency unless reactivation planned | Add 4–5 keyword-rich headlines per RSA |
| C12 | Move `JLRCertified_2026Q2` and `TeslaApproved_2026Q2` from MANUAL_CPC → MAXIMIZE_CONVERSIONS once ≥15 conv/mo accrued | scheduled fix, not urgent | Build after Q2 ramps |

---

## How to answer

Tell me which items in **section B** to execute and which to skip.
Tell me which items in **section C** to build next.
For anything in **section A** you want fixed differently than what B/C proposes, call out the A-number.

Example reply you can paste:
> Run B2, B1, B3, B4 in that order. Build C1 next using the sitemap CSV. Hold C7 until I check with client. Drop A12 from priority — I will manage budgets in UI.
