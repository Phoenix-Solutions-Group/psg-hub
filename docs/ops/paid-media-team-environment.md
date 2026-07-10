# Paid Media Team Environment

Last updated: 2026-07-10
Owner: Ada, Chief Developer
Scope: Body Shop Marketer paid media team setup

## Bottom Line

The Paid Media team should run inside Body Shop Marketer (BSM) and psg-hub first. We should not add a separate stack of tools when BSM already has Google Ads, Google Analytics, Google Search Console, Google Business Profile, reporting, approvals, and controlled Google Ads / Google Tag Manager change tooling.

The environment we need is mostly access, permissions, process, and documentation around the tools already built.

## Operating Principle

Use the simplest tool that already exists.

1. BSM is the working hub for campaign performance, reporting, client visibility, and proof of work.
2. psg-hub Ads Mutation Studio is the controlled place for Google Ads and Google Tag Manager changes.
3. Paperclip is the work tracker and board-reporting channel.
4. Graphify is for finding and understanding BSM code quickly.
5. Obsidian is only for durable campaign knowledge that does not belong in code or a task thread.
6. New paid tools require a clear gap, named owner, and board approval.

## What This Means For The Six PPC Roles

| Role | Runs primarily in | Needs access to |
| --- | --- | --- |
| Paid Media Auditor | BSM analytics and account audit views | Google Ads, Google Analytics 4, Search Console, Google Business Profile, SEMrush data already available to PSG |
| Tracking & Measurement Specialist | BSM analytics, psg-hub integrations, Ads Mutation Studio | Google Analytics 4, Google Tag Manager, Google Ads conversions, call tracking data if already used by the client |
| PPC Campaign Strategist | BSM reporting and psg-hub Ads Mutation Studio | Google Ads manager account, campaign structure, conversion data, landing page inventory |
| Search Query Analyst | BSM paid media reporting and Google Ads data | Search terms, negative keyword lists, keyword performance, client service-area rules |
| Ad Creative Strategist | BSM content and campaign planning surfaces | Google Ads assets, landing page content, PSG brand/persona guidance, approved creative assets |
| Analytics Reporter | BSM dashboards and Paperclip board updates | BSM reports, Google Ads, Google Analytics 4, Search Console, Google Business Profile, approved client notes |

## Required Account Access

These are access requirements, not new software purchases.

### Google Ads

- PSG manager account access for each managed client account.
- Google Ads API developer token on PSG's manager account.
- OAuth credentials already wired to psg-hub.
- Read access for auditors and reporters.
- Edit access only for approved campaign operators.
- Admin access limited to the account owner and one backup owner.
- Billing visibility for ad spend reconciliation.

### Google Analytics 4

- Property access for each client website.
- Access to real lead events: forms, calls, appointment requests, directions, and other high-value actions.
- Editor access only for the tracking owner and backup.
- Viewer or Analyst access for auditors, strategists, and reporters.

### Google Tag Manager

- Container access for each client website.
- Publish permission for the tracking owner and backup.
- Edit or approve permission for team members building tags.
- Read access for auditors and reporters.
- Changes should route through psg-hub / Ads Mutation Studio where BSM already supports the workflow.

### Google Business Profile

- Owner or manager access for each client location.
- Access to performance, reviews, calls, website clicks, directions, and local search actions.
- Posting access only when the campaign scope includes local posting.

### Google Search Console

- Website property access for each client.
- Query, page, location, and device data for campaign and landing-page decisions.
- Sitemap and indexing visibility for landing-page launch checks.

### Meta Business Suite, Facebook, and Instagram

Meta should stay optional, not part of the default first rollout.

Use Meta only when a client is actively running or approving paid social campaigns. When used, PSG needs partner access to the ad account, Facebook Page, Instagram account, pixel or dataset, audiences, and lead forms.

## BSM-First Tool Map

| Need | Use first | Add only if there is a gap |
| --- | --- | --- |
| Daily campaign work | BSM and psg-hub Ads Mutation Studio | Direct Google Ads UI for emergency/manual work |
| Campaign reporting | BSM dashboards and monthly report surfaces | Looker Studio only if the board wants an external dashboard view |
| Work tracking | Paperclip | Asana only for recurring delivery tasks that need calendar-style management |
| Client campaign knowledge | Paperclip issue documents and repo docs | Obsidian vault for long-lived client notes and process memory |
| Code lookup and impact checks | Graphify | Manual repo search after Graphify narrows the area |
| Keyword and competitor research | Existing PSG SEMrush access and BSM artifacts | Additional research tools only by approved exception |
| Landing page content | BSM / psg-hub content workflow | Sanity or external editor only where the page already lives there |
| Creative assets | Existing PSG asset library | Canva or Adobe only when a role needs production assets, not for basic campaign operations |
| Call tracking | Existing client call tracking data in BSM | CallRail or WhatConverts only when the client already uses it or tracking is missing |

## Graphify Versus Obsidian

Use Graphify when the question is about BSM code:

- Where does Google Ads reporting live?
- What code updates a dashboard?
- What could a tracking change affect?
- Which files should an engineer open before changing an integration?

Graphify is already approved in `Reference.md` and the repo runbook. It is local, fast, and token-efficient for code navigation. It should not ingest customer files, client documents, screenshots, or production data.

Use Obsidian only when the question is about reusable business knowledge:

- What is the campaign process for a body shop client?
- What did we learn from this client's last audit?
- Which objections, offers, and service areas matter for this shop?
- What should the next Paid Media agent know before continuing work?

The linked `AgriciDaniel/claude-obsidian` project is useful because it stores plain Markdown notes in an Obsidian vault, maintains links, and can keep session memory. That is valuable for campaign knowledge, but it is not a replacement for Graphify. It is also not required for the first environment setup unless we decide to create a PSG paid-media knowledge vault.

Recommendation: use Graphify for engineering and BSM code questions now. Use Paperclip issue documents and this repo for the initial PPC process. Add an Obsidian paid-media vault only if the team starts losing reusable campaign knowledge across clients and tasks.

## Minimal Process Capture

Keep the process simple:

1. One BSM client record per shop.
2. One Paperclip workstream per major campaign initiative.
3. One BSM dashboard view that shows the team's work and results.
4. One short daily board update in Paperclip.
5. One reusable setup checklist per client.
6. One audit summary per client before major changes.
7. One approval path for high-risk changes.

Do not create parallel documents unless the information will be reused.

## Client Onboarding Access Checklist

For each client, collect and confirm:

- Google Ads customer ID and PSG manager-account link.
- Google Analytics 4 property ID.
- Google Tag Manager account and container ID.
- Google Business Profile location access.
- Google Search Console property access.
- Meta access only when paid social is in scope.
- Existing call tracking provider, if any.
- Website or landing page access only when PSG must edit the page.
- Signed scope of work, approved monthly ad budget, and approval owner.
- Service areas, target repair types, certifications, preferred insurance relationships, excluded work, and capacity limits.

## Daily Board Reporting

The daily report should be short and plain English:

- What changed today.
- Whether spend is on pace.
- Leads, calls, and forms received.
- Tracking problems found or fixed.
- Wasted spend removed.
- New risks, blockers, or approval needs.
- What the team will do next.

## Required Safety Rules

- Use named user accounts. Do not share passwords.
- Require multi-factor authentication on ad, analytics, and business accounts.
- Keep at least two administrators for every critical account.
- Store secrets only in approved secret stores. Do not commit secrets to the repository.
- Separate read-only roles from change-making roles.
- Use dry-run previews before live ad or tracking changes.
- Keep audit logs for Google Ads and Google Tag Manager changes.
- Require approval for high-risk changes, including large budget changes, launches, restructures, broad-match expansion, or conversion tracking rewrites.

## Startup Sequence

1. Confirm which BSM surfaces the PPC team will use every day.
2. Confirm PSG's Google Ads manager account and backup administrator.
3. Connect each first-batch client account to BSM where the integration already exists.
4. Verify tracking before campaign changes.
5. Create the first BSM dashboard view for daily reporting.
6. Run the initial audit for each account.
7. Produce the first plain-English board summary from BSM data.
8. Begin live campaign changes only after tracking and approvals are clean.

## Current Repo Support

The repo already supports most of this environment:

- `apps/psg-hub` includes Google Ads, Google Analytics 4, Google Search Console, Google Business Profile, reporting, approval, and dashboard surfaces.
- `apps/psg-ads-mutations` contains controlled Google Ads and Google Tag Manager mutation tooling with dry-run and audit-log safety patterns.
- `Reference.md` names Graphify, Google Ads, Google Analytics 4, Google Search Console, SEMrush, BigQuery, Vercel, Supabase, Sanity, SendGrid, Twilio, and Lob as approved PSG engineering tools.
- `docs/runbooks/graphify-codebase-graph.md` confirms Graphify is the approved code-navigation tool for Ada, Ravi, Nora, and Tess.

## Open Setup Items

These are the only decisions still needed:

- Confirm PSG's official Google Ads manager account and backup administrator.
- Confirm the first client batch that needs PPC team access.
- Confirm whether Meta is in scope for the first rollout or deferred.
- Confirm whether existing BSM dashboards are enough for board reporting, or whether a Looker Studio export is still wanted later.
- Confirm whether Paperclip and repo docs are enough for campaign knowledge now, or whether we should create a lightweight Obsidian paid-media vault.
