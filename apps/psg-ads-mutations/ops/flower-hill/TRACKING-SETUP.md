# Flower Hill Auto Body — Tracking Setup
**This must be completed before any ads go live. Every dollar is wasted without proper conversion tracking.**

---

## Conversion Events to Track

| Conversion | Platform | Type | Value |
|------------|----------|------|-------|
| Phone call from ad (Google) | Google Ads | Call extension click | $80 (estimated CPL) |
| Phone call from website | Google Ads + Meta | Call tracking number | $80 |
| Form submission | Google Ads + Meta | Lead form | $80 |
| Google LSA lead | LSA | Automatic | Pay-per-lead |
| Meta lead form submit | Meta | Lead gen form | $80 |
| Direction request | Google | Micro-conversion | $5 |
| Website session >60s | Google/Meta | Engagement | $2 |

---

## Platform Tracking Setup Checklist

### Google Ads
- [ ] Google Ads account created (or access granted to PSG)
- [ ] Google Tag Manager container installed on website
- [ ] Google Ads conversion tag firing on:
  - [ ] Thank-you page (if form exists)
  - [ ] Phone call clicks (call extension + on-site number)
- [ ] Call tracking: Google forwarding numbers enabled on all campaigns
  - [ ] Separate forwarding number per location (3 numbers)
  - [ ] Minimum call duration = 30 seconds to count as conversion
- [ ] Google Business Profile linked to Google Ads (all 3 locations)
- [ ] Enhanced Conversions configured in Google Ads settings
- [ ] Conversion goals set as primary (not secondary) in campaign settings

### Google LSA
- [ ] LSA account created at ads.google.com/local-services-ads
- [ ] Business verification complete (license, insurance uploaded)
- [ ] Google Guaranteed badge applied for
- [ ] All three locations listed
- [ ] Budget cap set per location
- [ ] Lead review process established (dispute invalid leads within 30 days)

### Meta
- [ ] Meta Business Manager access granted to PSG
- [ ] Meta Pixel installed on website via GTM
- [ ] Meta Pixel firing on:
  - [ ] PageView (all pages)
  - [ ] Lead (form submission)
  - [ ] Contact (phone call clicks, direction clicks)
- [ ] Conversions API (CAPI) configured — **critical for iOS attribution**
  - Recommended: Pixel + CAPI in parallel (deduplication enabled)
- [ ] Custom audiences created:
  - [ ] Website visitors — All pages, 30 days
  - [ ] Website visitors — All pages, 90 days
  - [ ] Instagram engagers, 60 days
  - [ ] Facebook page engagers, 60 days

---

## Call Tracking Architecture

Three locations = three unique tracking numbers in ads.

| Location | Ad Platform Number | Notes |
|----------|-------------------|-------|
| Huntington | Google forwarding # (HTN) | Used in all HTN Google ads |
| Glen Cove | Google forwarding # (GC) | Used in all GC Google ads |
| Roslyn | Google forwarding # (ROS) | Used in all ROS Google ads |
| All locations | Meta ads → website | Meta uses website pixel to track calls via CallRail or similar |

**Recommended:** Layer CallRail (or similar) on top for:
- Call recording
- Whisper message ("Call from Google Ad — Huntington")
- CRM integration
- Call scoring

---

## UTM Parameter Framework

All non-Google ad links must use UTMs:

```
Base URL: flowerhill.com/contact (or location-specific landing page)

Meta format:
?utm_source=meta&utm_medium=paid_social&utm_campaign=FHAB_HTN_General_Awareness&utm_content=[ad_name]

Microsoft format:
?utm_source=bing&utm_medium=cpc&utm_campaign=FHAB_HTN_General_Search&utm_term={keyword}
```

---

## Reporting Setup

### Google Ads Columns to Track
- Impressions, Clicks, CTR, Avg CPC
- Calls from ads, Calls from website
- Conversions, Cost/Conversion
- Search impression share
- Quality score (keyword level)

### Meta Columns to Track
- Reach, Impressions, CPM
- Link clicks, CTR (link)
- Leads, CPL
- Frequency (keep below 3.5 before refreshing creative)
- Video ThruPlays (if running video)

### Monthly Reporting Dashboard (build in Google Looker Studio or similar)
- Calls by location
- CPL by platform
- Budget pacing vs. actuals
- Week-over-week call volume trend

---

## Pre-Launch Checklist

Before first campaign goes live:
- [ ] Pixel verified firing correctly (use Meta Pixel Helper extension)
- [ ] Google Tag Manager preview confirms conversion tags fire
- [ ] Test phone number click on mobile — does it trigger conversion?
- [ ] UTM parameters verified in GA4 (if active)
- [ ] Conversion goals set as "Primary" in Google Ads
- [ ] LSA verification complete
- [ ] At least 2 ad creative variants ready per ad set
- [ ] Negative keyword list uploaded to all Google Search campaigns
