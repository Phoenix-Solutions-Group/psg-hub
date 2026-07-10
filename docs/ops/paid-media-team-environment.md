# Paid Media Team Environment

Last updated: 2026-07-10
Owner: Ada, Chief Developer
Scope: Body Shop Marketer paid media team setup

## Bottom Line

The Paid Media team needs one shared operating environment that combines ad account access, website measurement, reporting, creative production, and controlled change approvals. The goal is that the team can audit, plan, improve, and report on client campaigns without waiting on manual handoffs, while still protecting client accounts from accidental or unauthorized changes.

## Team Roles This Environment Must Support

| Role | Main job | Must be able to access |
| --- | --- | --- |
| Paid Media Auditor | Review each account and identify waste, tracking gaps, and missed opportunity | Google Ads, Google Analytics 4, Google Tag Manager, call tracking, landing pages, Google Business Profile, Search Console, SEMrush |
| Tracking & Measurement Specialist | Confirm leads, calls, forms, and ads are measured correctly | Google Analytics 4, Google Tag Manager, Google Ads conversions, call tracking, website content management system, Search Console |
| PPC Campaign Strategist | Redesign account structure, budgets, targeting, and bidding | Google Ads manager account, campaign plans, keyword research, conversion data, landing page inventory |
| Search Query Analyst | Remove wasted spend and improve keyword quality | Google Ads search terms, negative keyword lists, SEMrush, client service area data |
| Ad Creative Strategist | Refresh ad copy, extensions, landing page messages, and creative variants | Google Ads assets, Meta assets when used, brand voice docs, customer persona docs, landing page editor, creative tools |
| Analytics Reporter | Build daily and monthly reporting for the board and client teams | Looker Studio, Google Analytics 4, Google Ads, Search Console, Google Business Profile, call tracking, BigQuery or Supabase reporting data |

## Required Core Access

### Google Ads

- PSG manager account access for every managed client account.
- Google Ads API developer token on the PSG manager account.
- OAuth credentials for the psg-hub Google Ads integration.
- Standard production access for live campaign data and managed changes.
- Read access for auditors and reporters.
- Edit access only for approved campaign operators.
- Admin access limited to the account owner and one backup owner.
- Billing visibility for finance reconciliation, including monthly ad spend and invoices.

Reference: Google states that Google Ads API use needs a manager account and developer token. See the official Google Ads API access documentation: https://support.google.com/google-ads/answer/15235 and https://developers.google.com/google-ads/api/docs/api-policy/developer-token.

### Google Analytics 4

- Account or property access for every client website.
- Editor access for the tracking specialist.
- Viewer or Analyst access for auditors, strategists, and reporters.
- Confirmed key events for forms, calls, appointment requests, directions, and other real lead actions.
- Data stream access so the team can verify the installed measurement tag.

### Google Tag Manager

- Container access for every client website.
- Publish permission for the tracking specialist and one backup.
- Edit and approve permissions for team members who build tags but should not publish without review.
- Read access for auditors and reporters.
- Two active administrators to avoid lockout.

Reference: Google Tag Manager supports account-level and container-level permissions, including read, edit, approve, and publish rights. See Google Tag Manager permissions: https://support.google.com/tagmanager/answer/6107011.

### Google Business Profile

- Owner or manager access for each client location.
- Permission to view profile performance, reviews, calls, website clicks, direction requests, and local search actions.
- Posting rights if the campaign includes local posting.
- Clear owner fallback if a profile is already claimed by another party.

Reference: Google Business Profile can be claimed or access can be requested for an existing profile. See Google's ownership request guide: https://support.google.com/business/answer/4566671.

### Google Search Console

- Property access for each client website.
- Access to query, page, location, and device performance.
- Sitemap and indexing visibility for landing page launch checks.

### Meta Business Suite, Facebook, and Instagram

- Partner access to the client's Meta business portfolio when Meta campaigns or retargeting are in scope.
- Access to the ad account, Facebook Page, Instagram account, dataset or pixel, custom audiences, and lead forms.
- Admin rights should stay with the client or PSG account owner; campaign operators get only the permissions needed for their role.

Reference: Meta supports partner access to business assets through Business Suite settings. See Meta's partner access guide: https://www.facebook.com/business/help/1717412048538897.

## Required Measurement And Reporting Tools

| Tool | Why the team needs it | Minimum setup |
| --- | --- | --- |
| Looker Studio | Client and board dashboards | Shared PSG templates, Google Ads and Google Analytics connectors, named owner |
| CallRail or WhatConverts | Phone lead tracking and call quality review | Number pools, source tracking, recording policy, lead outcome tags |
| BigQuery or Supabase reporting tables | Durable reporting history and cross-client analysis | Nightly data pulls, shop-level access controls, backup owner |
| psg-hub analytics pages | Internal single view of performance | Linked shop records, Google Ads, Google Analytics, Search Console, and Google Business Profile connections |
| psg-hub Ads Mutation Studio | Controlled Google Ads and Google Tag Manager changes | Dry-run previews, audit logs, approval gate for high-risk changes |

## Required Research And Planning Tools

| Tool | Why the team needs it |
| --- | --- |
| SEMrush | Keyword research, competitor analysis, wasted spend discovery, local search opportunity |
| Google Keyword Planner | Search volume, keyword expansion, cost estimates |
| Google Ads Transparency Center | Competitive ad review |
| Client intake form | Service areas, preferred jobs, certifications, insurance relationships, capacity limits |
| Brand and persona library | Keeps ad copy specific to collision repair customers and PSG's positioning |
| Landing page inventory | Confirms which campaigns have a relevant destination page |

## Required Creative And Landing Page Tools

| Tool | Why the team needs it |
| --- | --- |
| Sanity | Landing page and content management for psg-hub-backed pages |
| Canva or Adobe | Ad creative, display assets, social variants, and resized formats |
| Shared PSG asset library | Logos, shop photos, OEM certification badges, before-and-after images, proof points |
| Grammarly or equivalent review tool | Plain-language copy review before customer-facing launch |
| Approval queue | Prevents unreviewed copy, offers, or claims from going live |

## Required Operations Tools

| Tool | Why the team needs it |
| --- | --- |
| Paperclip | Work tracking, daily board updates, ownership, blockers, and approvals |
| Asana | Client delivery tasks and recurring campaign work |
| Pipedrive | Sales handoff context and client lifecycle status |
| PandaDoc | Signed scope of work and contract commitments |
| invoiced.app | Ad spend billing reconciliation and client invoicing |
| Obsidian or Notion | Persistent client knowledge base and campaign notes |
| Slack or email group | Time-sensitive internal alerts |

## Required Security And Governance

- Use named user accounts. Do not share passwords.
- Require multi-factor authentication on every ad, analytics, and business account.
- Keep at least two administrators for every critical account.
- Store secrets only in approved secret stores such as Vercel, Supabase, or the password manager. Do not commit secrets to the repository.
- Separate read-only roles from change-making roles.
- Use dry-run previews before live ad or tracking changes.
- Keep audit logs for every Google Ads or Google Tag Manager change.
- Require board approval for high-risk changes, including large budget changes, campaign launches, account restructures, broad-match expansion, or conversion tracking rewrites.
- Review user access monthly and remove departed users immediately.

## Client Onboarding Access Checklist

For each client, collect and confirm:

- Google Ads customer ID and manager-account link.
- Google Analytics 4 property ID.
- Google Tag Manager account and container ID.
- Google Business Profile location access.
- Google Search Console property access.
- Meta business portfolio, ad account, Page, Instagram account, dataset or pixel access when Meta is in scope.
- Call tracking provider access.
- Website content management access.
- Landing page domain and hosting access when PSG owns landing pages.
- Signed scope of work, billing terms, approved monthly ad budget, and approval owner.
- Service areas, target repair types, certifications, preferred insurance relationships, excluded work, and capacity limits.

## Daily Board Reporting

The team should report to the board once per day in plain English:

- What changed in the accounts today.
- Whether spend is on pace or needs attention.
- Leads, calls, and forms received.
- Tracking problems found or fixed.
- Wasted spend removed.
- New risks, blockers, or approval needs.
- What the team will do next.

## Startup Sequence

1. Confirm PSG-owned admin accounts and backup owners for Google, Meta, reporting, and billing tools.
2. Create the shared access request bundle for each client.
3. Connect every client account to psg-hub where the integration already exists.
4. Verify tracking before making campaign changes.
5. Build the first dashboard template in Looker Studio and psg-hub.
6. Run an initial audit for each account and produce the first plain-English board summary.
7. Only then begin live campaign restructuring or budget changes.

## Current Repo Support

The repo already contains support for several parts of this environment:

- `apps/psg-hub` includes Google Ads, Google Analytics 4, Google Search Console, Google Business Profile, reporting, and approval surfaces.
- `apps/psg-ads-mutations` contains controlled Google Ads and Google Tag Manager mutation tooling with dry-run and audit-log safety patterns.
- `Reference.md` names Google Ads, Google Analytics 4, Google Search Console, SEMrush, BigQuery, Vercel, Supabase, Sanity, SendGrid, Twilio, and Lob as approved PSG engineering tools.

## Open Setup Items

These items require account-owner action or a separately assigned implementation task:

- Confirm PSG's official Google Ads manager account and backup administrator.
- Confirm whether PSG will run Meta campaigns in the first paid media rollout or keep Meta optional.
- Confirm the call tracking standard: CallRail, WhatConverts, or both.
- Confirm the dashboard standard: Looker Studio only, psg-hub only, or both.
- Grant account access for the first client batch.
- Confirm which agent or team owns daily board reporting.
