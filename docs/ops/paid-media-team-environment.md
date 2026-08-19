# Paid Media Team Environment

Last updated: 2026-07-10
Owner: Ada, Chief Developer
Scope: Body Shop Marketer paid media team setup

## Bottom Line

The Paid Media team should run inside Body Shop Marketer (BSM) and psg-hub first. We should not add a separate stack of tools when BSM already has Google Ads, Google Analytics, Google Search Console, Google Business Profile, reporting, approvals, controlled Google Ads / Google Tag Manager change tooling, SEMrush, GTmetrix, Supabase, and market-intelligence paths.

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
| Paid Media Auditor | BSM analytics and account audit views | Google Ads, Google Analytics 4, Search Console, Google Business Profile, SEMrush, Local Falcon, Yext, GTmetrix, Supabase shop data |
| Tracking & Measurement Specialist | BSM analytics, psg-hub integrations, Ads Mutation Studio | Google Analytics 4, Google Tag Manager, Google Ads conversions, GTmetrix, Cloudflare, cPanel, call tracking data if already used by the client |
| PPC Campaign Strategist | BSM reporting and psg-hub Ads Mutation Studio | Google Ads manager account, campaign structure, conversion data, Local Falcon local rankings, SEMrush keyword data, landing page inventory |
| Search Query Analyst | BSM paid media reporting and Google Ads data | Search terms, negative keyword lists, keyword performance, SEMrush, service-area rules from Supabase |
| Ad Creative Strategist | BSM content and campaign planning surfaces | Google Ads assets, landing page content, PSG brand/persona guidance, Google Business Profile insights, Local Falcon local visibility data |
| Analytics Reporter | BSM dashboards and Paperclip board updates | BSM reports, Google Ads, Google Analytics 4, Search Console, Google Business Profile, SEMrush, Local Falcon, Yext, GTmetrix, approved client notes |

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

### Supabase And BSM Shop Data

- Access to the BSM Supabase database through approved server-side routes and service jobs only.
- Use the `shops` and `body_shops` registry data to ground targeting, service areas, locations, and reporting.
- Keep customer and shop data inside BSM access controls. Do not export production shop data into Graphify or ad-hoc local files.
- Use Supabase as the durable source for BSM dashboards, audit history, account links, and daily reporting inputs.

### SEMrush

- Use existing PSG SEMrush access for keyword research, competitor discovery, paid/organic overlap, domain health, and wasted-spend context.
- Feed summarized SEMrush outputs into BSM reporting and audit notes instead of making SEMrush a separate place the team has to check every day.
- Keep API usage controlled because SEMrush reports can be metered by row/report.

### Local Falcon

- Use existing Local Falcon access for local map-pack visibility, local rank grids, Share of Local Voice, and local search opportunity around each shop.
- Use Local Falcon outputs to support Google Business Profile optimization, service-area strategy, and local campaign recommendations.
- Treat Local Falcon as an input to BSM, not a second reporting dashboard unless the board asks for its native visuals.

### Yext

- Use Yext where a client is eligible or already connected for listings, reviews, publisher accuracy, and digital presence data.
- Feed Yext status into BSM so the PPC team can see whether poor local presence may be hurting paid campaign performance.
- Do not create duplicate listing-management work outside BSM unless a Yext workflow requires it.

### GTmetrix

- Use GTmetrix for landing-page speed, Core Web Vitals context, page weight, and technical landing-page blockers.
- BSM already has GTmetrix-related code, so the PPC team should use BSM/performance reporting first.
- Use GTmetrix findings to prioritize landing-page fixes before scaling spend.

### Cloudflare

- Use Cloudflare access when PSG controls or supports a client's domain, redirects, caching, DNS, firewall, or analytics.
- Keep DNS and security changes approval-gated because a bad change can take a client site offline.
- Use Cloudflare data as context for tracking failures, redirect issues, speed problems, and launch readiness.

### cPanel

- Use cPanel only for clients whose hosting still requires it.
- Access should be limited to the tracking or website owner and used for tag placement, redirects, files, and basic hosting checks.
- Prefer BSM, Cloudflare, or the client's modern content workflow when available; cPanel is a legacy access path, not the primary operating tool.

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
| Keyword and competitor research | SEMrush, Supabase shop data, and BSM artifacts | Additional research tools only by approved exception |
| Local visibility | Local Falcon, Google Business Profile, and Yext data inside BSM | Native Local Falcon/Yext dashboards only for deep diagnostics |
| Landing-page performance | BSM performance reporting and GTmetrix | Direct GTmetrix only for deeper technical review |
| Domain and hosting checks | Cloudflare where PSG has access; cPanel only for legacy hosting | Direct registrar/host access only when Cloudflare or BSM cannot solve it |
| Landing page content | BSM / psg-hub content workflow | Sanity or external editor only where the page already lives there |
| Creative assets | Existing PSG asset library | Canva or Adobe only when a role needs production assets, not for basic campaign operations |
| Call tracking | Existing client call tracking data in BSM | CallRail or WhatConverts only when the client already uses it or tracking is missing |

## Technical Data And API Layer

The PPC team should not have to open every vendor dashboard every day. BSM should collect, summarize, or link to the right data so the team can make decisions from one operating view.

| Source | What BSM should use it for | Primary owner |
| --- | --- | --- |
| Supabase BSM database | Shop registry, service areas, customer/account links, campaign notes, reporting history, and all body-shop market context PSG already stores | Engineering |
| Google Ads API | Spend, clicks, conversions, search terms, campaigns, ads, assets, negatives, and controlled campaign changes | Paid Media / Engineering |
| Google Analytics 4 API | Website traffic, engaged sessions, lead events, landing-page behavior, and conversion validation | Tracking |
| Google Tag Manager API | Tag and trigger review, controlled tag changes, and measurement cleanup | Tracking |
| Google Business Profile API | Local actions, reviews, calls, directions, website clicks, posts where in scope, and location performance | Local presence |
| Google Search Console API | Search queries, landing-page visibility, indexing, and search performance | Analytics |
| SEMrush API | Keyword opportunity, competitor search visibility, domain metrics, and paid/organic overlap | Audit / Strategy |
| Local Falcon API or exports | Geo-grid local rankings, Share of Local Voice, AI/local visibility, and Google Business Profile opportunity | Local presence |
| Yext API | Listings, publisher accuracy, reviews, and eligible Growth+ shop digital-presence data | Local presence |
| GTmetrix API | Landing-page speed and technical performance blockers | Tracking / Web |
| Cloudflare API | DNS, redirects, cache, firewall, and domain analytics when PSG has access | Web / Tracking |
| cPanel access | Legacy hosting edits, files, redirects, and tag placement only when needed | Web / Tracking |

Rule: vendor tools feed BSM. They should not become separate daily workspaces unless the task truly requires the native vendor interface.

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
8. One technical data inventory per client showing which APIs and accounts are connected.

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
- SEMrush project/domain access or domain target.
- Local Falcon location and keyword scan setup where local visibility matters.
- Yext entity or account access where the client is eligible or already connected.
- GTmetrix target URLs for main landing pages.
- Cloudflare zone access where PSG manages DNS, redirects, caching, or security.
- cPanel access only for legacy hosting/tag/redirect work.
- Website or landing page access only when PSG must edit the page.
- Signed scope of work, approved monthly ad budget, and approval owner.
- Service areas, target repair types, certifications, preferred insurance relationships, excluded work, and capacity limits.

## Daily Board Reporting

The daily report should be short and plain English:

- What changed today in campaigns, tracking, local presence, or landing pages.
- Whether spend is on pace.
- Leads, calls, and forms received.
- Tracking problems found or fixed.
- Wasted spend removed.
- Local visibility movement from Google Business Profile, Local Falcon, Yext, or SEMrush when relevant.
- Landing-page speed or technical problems from GTmetrix, Cloudflare, or cPanel when relevant.
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
- Require approval for DNS, redirect, firewall, hosting, or tag changes that can affect a live client site.
- Keep API keys and OAuth tokens out of issue comments, repo docs, screenshots, and Graphify ingestion.

## Startup Sequence

1. Confirm which BSM surfaces the PPC team will use every day.
2. Confirm PSG's Google Ads manager account and backup administrator.
3. Build the technical data inventory for the first client batch: Google Ads, Google Analytics, Google Tag Manager, Google Business Profile, Search Console, SEMrush, Local Falcon, Yext, GTmetrix, Cloudflare, cPanel, Supabase records, and call tracking where applicable.
4. Connect each first-batch client account to BSM where the integration already exists.
5. Verify tracking before campaign changes.
6. Create the first BSM dashboard view for daily reporting.
7. Run the initial audit for each account.
8. Produce the first plain-English board summary from BSM data.
9. Begin live campaign changes only after tracking and approvals are clean.

## Current Repo Support

The repo already supports most of this environment:

- `apps/psg-hub` includes Google Ads, Google Analytics 4, Google Search Console, Google Business Profile, SEMrush, GTmetrix, reporting, approval, and dashboard surfaces.
- `apps/psg-ads-mutations` contains controlled Google Ads and Google Tag Manager mutation tooling with dry-run and audit-log safety patterns.
- `Reference.md` names Graphify, Google Ads, Google Analytics 4, Google Search Console, SEMrush, Yext, BigQuery, Vercel, Supabase, Sanity, SendGrid, Twilio, and Lob as approved PSG engineering tools.
- `docs/runbooks/graphify-codebase-graph.md` confirms Graphify is the approved code-navigation tool for Ada, Ravi, Nora, and Tess.
- `PLANNING.md` and `apps/psg-hub/README.md` identify the shared Supabase project, the `shops` and `body_shops` data, Yext, SEMrush, and BSM marketing/reporting surfaces as part of the platform direction.

## Open Setup Items

These are the only decisions still needed:

- Confirm PSG's official Google Ads manager account and backup administrator.
- Confirm the first client batch that needs PPC team access.
- Confirm whether Meta is in scope for the first rollout or deferred.
- Confirm whether existing BSM dashboards are enough for board reporting, or whether a Looker Studio export is still wanted later.
- Confirm whether Paperclip and repo docs are enough for campaign knowledge now, or whether we should create a lightweight Obsidian paid-media vault.
- Confirm which existing API credentials are already available for SEMrush, Local Falcon, Yext, GTmetrix, Cloudflare, and client hosting access.
