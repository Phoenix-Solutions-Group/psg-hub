# Wallace Collision — GTM Setup Guide

**GTM Container:** GTM-KF7JXTB  
**GA4 Property:** 313002669  
**GA4 Measurement ID:** G-1TT9NE6912  
**Site:** WordPress + Elementor  
**Date:** 2026-05-06

---

## Quick Import (Recommended)

Import `gtm-import.json` directly instead of building tags manually:

1. GTM → Admin → Import Container
2. File: `gtm-import.json`
3. Workspace: Default (or create new)
4. Merge: "Rename conflicting tags, triggers, and variables"
5. Confirm → review → Publish

Creates: GA4 Configuration (G-1TT9NE6912), qualify_lead event (both trigger methods), phone_click event.  
After import — pick which qualify_lead trigger matches your setup, delete the other one.

---

## Prerequisites

1. GTM container (GTM-KF7JXTB) installed on WordPress site
   - Verify: view page source → search for `GTM-KF7JXTB` — should appear twice (head + body)
   - If missing: install via WPCode plugin or "Insert Headers and Footers" plugin
2. GA4 property linked to Google Ads (Tools → Conversions → Google Analytics 4 in Google Ads UI)

---

## Events to Create

| GTM Tag            | GA4 Event Name | Trigger                               | Priority                   |
| ------------------ | -------------- | ------------------------------------- | -------------------------- |
| GA4 — qualify_lead | `qualify_lead` | Form submit on estimate/contact pages | P1                         |
| GA4 — phone_click  | `phone_click`  | Click on tel: phone links             | P1                         |
| GA4 — page_view    | (base config)  | All pages                             | P0 — likely already exists |

---

## Step 1 — Verify GA4 Base Tag Exists

In GTM → Tags:

- Look for a tag named "GA4 Configuration" or "Google Analytics: GA4 Configuration"
- Should fire on "All Pages"
- Should contain your Measurement ID (G-1TT9NE6912)

If missing: create it now before adding event tags.

**Create GA4 Configuration tag:**

1. GTM → Tags → New
2. Tag type: Google Analytics → GA4 Configuration
3. Measurement ID: G-1TT9NE6912
4. Trigger: All Pages
5. Name: "GA4 — Configuration"
6. Save

---

## Step 2 — qualify_lead Event (Form Submit)

### Option A: Thank-You Page Redirect (Recommended — works with all Elementor versions)

**In Elementor:** Edit your estimate/contact form → Actions After Submit → Add "Redirect" action → URL: `/thank-you/`

Create a `/thank-you/` page in WordPress (simple page, just needs to exist with a "Thank You" message).

**In GTM — Create Trigger:**

1. Triggers → New
2. Type: Page View
3. Fire on: Some Page Views
4. Condition: Page URL → contains → `/repair-estimate/`
5. Name: "Trigger — Repair Estimate Page View"
6. Save

**In GTM — Create Tag:**

1. Tags → New
2. Tag type: Google Analytics → GA4 Event
3. Configuration Tag: your GA4 Configuration tag
4. Event Name: `qualify_lead`
5. Trigger: "Trigger — Thank You Page View"
6. Name: "GA4 — qualify_lead"
7. Save

---

### Option B: Elementor Pro dataLayer Push (if Elementor Pro installed)

**In Elementor Pro form settings:**

1. Edit form widget → Actions After Submit
2. Add action: "Custom Action"
3. Paste this JavaScript:

```javascript
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: "form_submit_estimate",
  form_name: "estimate_form",
});
```

**In GTM — Create Trigger:**

1. Triggers → New
2. Type: Custom Event
3. Event Name: `form_submit_estimate`
4. Name: "Trigger — Elementor Form Submit"
5. Save

**In GTM — Create Tag:**

1. Tags → New
2. Tag type: Google Analytics → GA4 Event
3. Configuration Tag: your GA4 Configuration tag
4. Event Name: `qualify_lead`
5. Trigger: "Trigger — Elementor Form Submit"
6. Name: "GA4 — qualify_lead"
7. Save

---

### Option C: GTM All Forms Trigger (fallback — catches all forms)

Use if A and B aren't feasible. Less precise but works without touching Elementor settings.

**In GTM — Create Trigger:**

1. Triggers → New
2. Type: Form Submission
3. Check: Wait for Tags, Check Validation
4. Fire on: Some Forms
5. Condition: Page URL → contains → `/contact` or `/estimate`
   (narrow to pages with the actual form)
6. Name: "Trigger — Form Submit (Contact/Estimate)"
7. Save

**In GTM — Create Tag:** same as above, fire on this trigger.

---

## Step 3 — Phone Click Tracking

**In GTM — Create Variable:**

1. Variables → New (User-Defined)
2. Type: Auto-Event Variable
3. Variable Type: Click URL
4. Name: "Variable — Click URL"
5. Save

**In GTM — Create Trigger:**

1. Triggers → New
2. Type: Click — All Elements
3. Fire on: Some Clicks
4. Condition: Click URL → starts with → `tel:`
5. Name: "Trigger — Phone Link Click"
6. Save

**In GTM — Create Tag:**

1. Tags → New
2. Tag type: Google Analytics → GA4 Event
3. Configuration Tag: your GA4 Configuration tag
4. Event Name: `phone_click`
5. Event Parameters: Add parameter → Name: `phone_number`, Value: `{{Click URL}}`
6. Trigger: "Trigger — Phone Link Click"
7. Name: "GA4 — phone_click"
8. Save

---

## Step 4 — Publish and Verify

1. GTM → Submit → Version Name: "Wallace — qualify_lead + phone_click tracking"
2. After publish — open the live site in Preview mode (GTM debug panel)
3. Submit the estimate form → confirm `qualify_lead` event fires in GTM preview
4. Click a phone number → confirm `phone_click` event fires
5. Open GA4 → Realtime → confirm events appear under "Event count by event name"
6. Open Google Ads → Tools → Conversions → GA4 import → "qualify_lead" should appear

---

## Step 5 — Enable qualify_lead in Google Ads (Manual UI Step)

After GTM is publishing the `qualify_lead` event to GA4:

1. Google Ads → Tools & Settings → Conversions
2. Click "Google Analytics 4" tab (or filter by type)
3. Find "Wallace Collision Center - GA4 (web) qualify_lead"
4. Click the pencil icon → Status → change from HIDDEN → ENABLED
5. Set as primary conversion goal
6. **OR** run `fix_conversion_actions.py` which handles this via API

Note: The GA4 event must be firing for at least 24h before Google Ads can import it. If the event is new, wait one day after GTM publish before enabling in Google Ads.

---

## Step 6 — Link GA4 to Google Ads (if not already linked)

1. GA4 → Admin → Google Ads Linking
2. Click "Link" → select the Wallace Collision Google Ads account (604-861-1995)
3. Enable personalized advertising toggle
4. Submit

This enables GA4 audience import and allows Google Ads to see GA4 events.

---

## Verification Checklist

- [ ] GTM-KF7JXTB installed on all site pages (head + body snippets)
- [ ] GA4 Configuration tag firing on All Pages
- [ ] qualify_lead event fires on form submit (verified in GTM Preview)
- [ ] qualify_lead event appears in GA4 Realtime
- [ ] phone_click event fires on phone link clicks (verified in GTM Preview)
- [ ] GA4 linked to Google Ads account 604-861-1995
- [ ] qualify_lead imported in Google Ads and set to primary (or run fix script)
- [ ] Landing Page demoted from Smart Bidding (run fix script)
- [ ] Form counting fixed to ONE_PER_CLICK (run fix script)

---

## Running the Fix Script

Once `.env` credentials are in `apps/ads/.env`:

```bash
# Preview changes (no writes)
cd apps/ads
python wallace/fix_conversion_actions.py --dry-run

# Apply changes
python wallace/fix_conversion_actions.py
```

Required env vars in `apps/ads/.env`:

```
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...
GOOGLE_ADS_REFRESH_TOKEN=...
GOOGLE_ADS_LOGIN_CUSTOMER_ID=...
```
