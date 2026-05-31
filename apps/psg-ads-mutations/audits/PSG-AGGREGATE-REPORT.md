# PSG Multi-Account Google Ads Audit — Aggregate

**Date:** 2026-05-18 | **Window:** LAST_30_DAYS (2026-04-18 → 2026-05-18)
**MCC:** Phoenix Solutions Group (6935795509)
**Scope:** 3 accounts requested. 2 audited. 1 blocked.

---

## Aggregate Health Scores

| Account | CID | Score | Grade | Status |
|---|---|---|---|---|
| Wallace Collision Center | 6048611995 | **38 / 100** | F | Audited |
| Tedesco Auto Body | 7763526490 | **60 / 100** | C | Audited |
| Flower Hill Auto Body | 5509988313 | — | — | **BLOCKED** (MCP permission / token) |

**2-account weighted average (by 30d spend):**
- Wallace spend: $3,385 → 38 × ($3,385 / $6,434) = 19.99
- Tedesco spend: $3,049 → 60 × ($3,049 / $6,434) = 28.43
- **PSG aggregate (2 accounts) = 48.4 → Grade D**

Flower Hill excluded until MCP unblocked.

---

## Category Score Matrix

| Category | Weight | Wallace | Tedesco | Delta |
|---|---|---|---|---|
| Conversion Tracking | 25% | 39 | 73 | +34 Tedesco |
| Wasted Spend / Negatives | 20% | 33 | 61 | +28 Tedesco |
| Account Structure | 15% | 38 | 63 | +25 Tedesco |
| Keywords & Quality Score | 15% | 31 | 48 | +17 Tedesco |
| Ads & Assets | 15% | 56 | 46 | +10 Wallace |
| Settings & Targeting | 10% | 39 | 47 | +8 Tedesco |

Tedesco wins 5/6 categories. Wallace edges Ads & Assets only because Tedesco's 56-of-66 POOR RSA strength tanks that score.

---

## Cross-Account Critical Findings (shared patterns)

### 1. Zero Shared Negative Keyword Lists (G14/G15)
Both Wallace and Tedesco run **zero functional shared negative lists**. Wallace has one "Porsche" BRANDS list with 0 references; Tedesco has none at all. This is a 15-minute MCC-level fix that improves both accounts at once.

**Recommendation:** Build 4 themed shared lists at the MCC (or per-account):
- Jobs / Careers (job, hiring, salary, employment, training)
- DIY / How-to (how to, diy, tutorial, video, learn)
- Free / Cheap (free, cheap, junkyard, salvage, used parts)
- Insurance Info (insurance claim how, file claim, deductible explanation)

Apply to every ENABLED Search campaign in both accounts.

### 2. Conversion Signal Pollution (G47 / G-CT1)
**Wallace:** 8 of 14 ENABLED conversion actions marked Primary, including 5 GBP micro events (Directions, Website visits, Other engagements, Menu views, Smart map clicks-to-call). Inflates CVR to bogus 39.77% and steers Smart Bidding toward soft signals.

**Tedesco:** Cleaner (2 advertiser-controlled primaries), but "Contact Us" (CONTACT category) marked primary is borderline soft. Tedesco also has 33 total conversion actions cluttered with REMOVED/HIDDEN legacy entries.

**Recommendation:** Demote GBP `Local actions - *` and Smart Campaign micro events from Primary across both. Keep only Form, qualified-lead, and Calls-from-ads as Primary.

### 3. Geo Targeting Method (G11)
**Tedesco:** All 4 ENABLED persona Search campaigns set to **PRESENCE_OR_INTEREST** — leaks budget to anyone *searching about* Westchester rather than physically in market. 2-minute fix per campaign.

**Wallace:** Not flagged as widely but worth verifying on the new 2026Q2 cohort before they ramp.

### 4. Ad Strength + Headline Count (G27 / G29)
**Tedesco:** 56 of 66 RSAs at POOR strength, every RSA stuck at 5 headlines (recommended ≥8, ideal 12–15). This crushes Quality Score across the persona campaigns.

**Wallace:** 4 RSAs POOR, 18 AVERAGE. Less severe but the new 2026Q2 stack should launch with 12–15 headlines per RSA, not 5.

### 5. No PMax Despite Eligibility (G06)
Both accounts have sufficient conversion volume to test PMax (Wallace ~745 conv/mo, Tedesco 70+ in 30d with persona Search alone). Tedesco has 2 PMax campaigns built but PAUSED. Wallace has zero PMax built.

**Recommendation:** Re-enable Tedesco's paused PMax with brand exclusions + Customer Match audience signals. Build Wallace PMax with brand exclusions configured from day one.

### 6. Account State Hygiene
**Wallace:** In the middle of a stalled 2026Q2 cutover. 92% of spend on PAUSED legacy campaigns; the new ENABLED `GOOG_WAL_SRCH_*_2026Q2` cohort has zero impressions; the Brand defense campaign is PAUSED leaving brand undefended. **Highest urgency: enable the brand campaign.**

**Tedesco:** 7 Search and 2 PMax campaigns PAUSED. Decide: re-enable or archive. Clutter inflates audit noise.

---

## Cross-Account Quick Wins (do once, benefits both)

| # | Action | Time | Accounts affected |
|---|---|---|---|
| 1 | Build 4 themed shared negative lists at MCC level, attach to all ENABLED Search campaigns | 20 min | Wallace + Tedesco (+ Flower Hill when unblocked) |
| 2 | Demote micro conversions (GBP `Local actions - *`, Smart Campaign clicks-to-call, etc.) from Primary | 10 min each | Wallace + Tedesco |
| 3 | Switch geo targeting from `PRESENCE_OR_INTEREST` to `PRESENCE` on every local-service campaign | 2 min/campaign | Tedesco (4), Wallace (verify Q2 cohort) |
| 4 | Add 7+ headline variants to every RSA below 8 headlines | 15 min/group | Tedesco (66 RSAs), Wallace (4 POOR + 18 AVG) |
| 5 | Enable Wallace `GOOG_WAL_SRCH_Brand_2026Q2` to defend brand | 5 min | Wallace |
| 6 | Verify Advanced Consent Mode v2 with site teams | 30 min | Both |

---

## Cross-Account Wasted Spend Estimate

| Account | Wasted spend (30d) | Annualized |
|---|---|---|
| Wallace | ~$278 (Tesla informational queries; 22.4% of relevant search-term spend) | ~$3,340 |
| Tedesco | Per Tedesco report (see audits/tedesco/) — lower % but $12 on the brand term "tedesco auto body new rochelle" with 0 attributed conversions flags a tracking gap | TBD |

The bigger waste in both accounts is opportunity cost: missing Quality Score lift (G24 landing-page experience), missing PMax volume, undefended brand. Hard to quantify; bigger than the negative-keyword leak.

---

## Data Gaps (G-SYS1, applies to both audited accounts)

These checks are not derivable from the Google Ads API alone. Verify with the site team or Tag Assistant:

- **G-CT3** — Google Tag firing on all pages (manual Tag Assistant check)
- **G45** — Consent Mode v2 mode (Basic vs Advanced) — not surfaced in API
- **G44** — Server-side GTM presence — needs GTM container review
- **G59** — Mobile LCP < 2.5s — PageSpeed Insights
- **G60** — Landing-page H1/title relevance per ad group — manual SERP-side check
- **G61** — Schema markup (Product/FAQ/Service)
- **G30** — RSA pinning map per ad — pin data exposed in API but not pulled in this run
- **G38** — Smart Bidding learning-phase status — exposed in `bidding_strategy` resource, worth pulling next run

---

## Flower Hill Audit — BLOCKED

**Cause:** MCP server `google-ads-mcp` token expired mid-session, and the subagent received `PERMISSION_DENIED` for customer 5509988313 even before token expiry. Root causes:

1. **Token expiry** — affects all 3 accounts now; need re-auth via `/mcp` reconnect.
2. **MCC-only access** — `nick@phoenixsolutionsgroup.net` has direct grants on Wallace and Tedesco (both appear in `list_accessible_customers`) but **only manager-link access** on Flower Hill. The MCP server may not be propagating `login-customer-id: 6935795509` header for child accounts not directly accessible.

**Unblock paths:**

| Option | Effort | Tradeoff |
|---|---|---|
| A. `/mcp` reconnect, then retry — see if MCC env (`GOOGLE_ADS_LOGIN_CUSTOMER_ID=693-579-5509`) propagates | 2 min | Cleanest. Try first. |
| B. Grant `nick@phoenixsolutionsgroup.net` direct access on Flower Hill (Google Ads UI → Admin → Access) | 5 min | Permanent fix for all future MCP work |
| C. Use the existing Python SDK path (`googleads_psg`) which reads `apps/ads/.env` directly — bypass MCP entirely for Flower Hill | 30 min | Already wired for write-side work; reuse for read |

**Recommended:** A first (test), B second (durable).

---

## Next Steps

1. **User action needed:** `/mcp` reconnect to refresh google-ads-mcp token, then rerun Flower Hill audit
2. **Cross-account remediation:** prioritize the 6 cross-account Quick Wins above (estimated 60–90 min total for both accounts)
3. **Per-account deep work:** see individual reports
   - `audits/wallace/GOOGLE-ADS-REPORT.md` (38/100, F — stalled cutover, signal pollution)
   - `audits/tedesco/GOOGLE-ADS-REPORT.md` (60/100, C — ad strength + geo + negatives)
   - `audits/flower-hill/GOOGLE-ADS-REPORT.md` (BLOCKED — re-run after unblock)
