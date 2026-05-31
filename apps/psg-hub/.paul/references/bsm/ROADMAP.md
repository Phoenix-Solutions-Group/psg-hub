# Roadmap: BSM (Body Shop Marketer)

## Overview

BSM builds from a proven agent engine running on existing PSG clients to a customer-facing SaaS product for collision repair shops. Each phase delivers independently testable value. The first three phases prove the system works and generates revenue. The remaining phases expand capability and market reach.

## Current Milestone

**v0.1 Agent Engine MVP** (v0.1.0)
Status: In progress
Phases: 4 of 7 complete

## Phases

| Phase | Name | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| 1 | Agent engine | 7 | Complete | 2026-04-11 |
| 2 | Internal operations | 5 | Complete | 2026-04-12 |
| 3 | Content preview and client approval | 5 | Complete | 2026-04-12 |
| 4 | Customer-facing MVP | 3 | Complete | 2026-04-12 |
| 5 | Reputation and ads | TBD | Not started | - |
| 6 | Email/SMS and analytics | TBD | Not started | - |
| 7 | Intelligence and scale | TBD | Not started | - |

## Phase Details

### Phase 1: Agent engine

**Goal:** Four collaborative AI agents running on 2-3 existing PSG client sites, producing measurable SEO and content improvements.
**Depends on:** Nothing (first phase)
**Research:** Likely (Paperclip configuration, BigQuery geodata schema, SEMrush API integration patterns)
**Research topics:** Paperclip heartbeat system configuration, BigQuery geodata table/field names, Sanity content model for agent outputs

**Scope:**
- Create SEO auditor, market researcher, and content writer skills via /skillsmith
- Configure Paperclip with four-agent org structure and budget limits
- Build shop profile schema (JSON in filesystem)
- Wire SEMrush API, Firecrawl MCP, Sanity MCP, BigQuery
- Smart shop onboarding (name + address, auto-discover rest)
- Competitor discovery via BigQuery geodata
- Run full agent cycle on test clients and evaluate output

**Plans:**
- [ ] 01-01: Build SEO auditor agent skill
- [ ] 01-02: Build market researcher agent skill
- [ ] 01-03: Build content writer agent skill
- [ ] 01-04: Configure Paperclip orchestration
- [ ] 01-05: Wire integrations (SEMrush, BigQuery, Sanity, Firecrawl)
- [ ] 01-06: Smart shop onboarding and competitor discovery
- [ ] 01-07: Test on Phil Long and evaluate results

### Phase 2: Internal operations

**Goal:** PSG account managers run the agent system across all collision repair clients from a single internal dashboard.
**Depends on:** Phase 1 (agents must be producing quality output)
**Research:** Unlikely (Paperclip UI is built-in, Sanity Studio is established)

**Scope:**
- Paperclip React UI configured for PSG account managers
- Shop profile management (view, edit, override auto-discovered data)
- Competitor landscape view
- Content review workflow via Sanity Studio
- Agent scheduling configuration
- Migrate shop data from filesystem to PostgreSQL
- Google Search Console and Google Business Profile OAuth per shop

**Plans:**
- [ ] 02-01: Paperclip UI configuration for PSG
- [ ] 02-02: Shop profile management and competitor landscape
- [ ] 02-03: Content review workflow (Sanity Studio)
- [ ] 02-04: Agent scheduling and data migration
- [ ] 02-05: Google Search Console and GBP integration

### Phase 3: Content preview and client approval

**Goal:** Clients can preview agent-produced content styled to match their website, approve or request changes, and approved content gets published. Three layers: Sanity preview mode (immediate), styled HTML staging pages (immediate), and integrated client portal preview (Phase 4 enhancement).
**Depends on:** Phase 2 (Sanity content model, agent output workflow)
**Research:** Likely (Sanity preview API, client site design scraping, HTML template generation)
**Research topics:** Sanity preview/presentation mode, Firecrawl for design extraction, static HTML generation from Sanity content

**Scope:**
- Option A: Sanity preview mode with shareable preview links per content item
- Option B: Styled HTML staging pages that match each client's existing site design (colors, fonts, layout)
- Option D: Content preview component integrated into the Phase 4 client portal (Next.js dashboard)
- Client approval flow: preview link sent to client, client approves/requests changes, approved content published
- Design extraction: scrape client site to capture CSS variables, fonts, color palette, layout patterns
- Template system: per-client preview templates generated from scraped design

**Plans:**
- [ ] 03-01: Sanity preview mode with shareable links
- [ ] 03-02: Client site design extraction (Firecrawl + CSS parsing)
- [ ] 03-03: Styled HTML preview template generator
- [ ] 03-04: Client approval workflow (preview link > approve/reject > publish)
- [ ] 03-05: UI/UX site designer agent (crawl site, extract templates, register in swarm)

### Phase 4: Customer-facing MVP

**Goal:** BSM is a product someone pays for. First external paying customers onboarded.
**Depends on:** Phase 3 (content preview and client approval must work before customer-facing launch)
**Research:** Likely (Supabase RLS multi-tenant patterns, Stripe subscription integration)
**Research topics:** Next.js + Supabase Auth + RLS configuration, Stripe subscription lifecycle

**Scope:**
- Next.js client dashboard (PSG brand, uncodixfy constraints)
- Supabase Auth with role-based access (owner, manager, admin)
- Multi-tenant PostgreSQL with RLS
- Client onboarding wizard (smart defaults)
- Client dashboard (activity, content, rankings, agent status)
- Dual approval workflow (agent > PSG > client > publish)
- Stripe billing (Essentials $199/mo, Growth $499/mo)

**Plans:**
- [ ] 04-01: Next.js app scaffold with PSG design system
- [ ] 04-02: Supabase Auth and multi-tenant RLS
- [ ] 04-03: Client dashboard views (includes content preview from Phase 3)
- [ ] 04-04: Dual approval workflow
- [ ] 04-05: Stripe billing and tier enforcement
- [ ] 04-06: Client onboarding wizard

### Phase 5: Reputation and ads

**Goal:** BSM covers content, SEO, reputation, and paid search for collision repair.
**Depends on:** Phase 4 (customer-facing platform must exist)
**Research:** Likely (Google Ads API, review platform APIs)
**Research topics:** Google Ads API campaign management, Yelp Fusion API constraints

**Scope:**
- Review monitoring across Google, Yelp, Facebook, Carwise
- AI review response drafts (tone-matched per platform)
- Google Ads integration with collision repair campaign templates
- Ads performance dashboard
- Performance tier ($999/mo)

**Plans:**
- [x] 05-01: Review ingestion and monitoring
- [x] 05-02: AI review response generation
- [x] 05-03: Google Ads API integration
- [ ] 05-04: Performance tier billing + ads scaffold (account link UI + sidebar + tier-gate upgrade CTA)
- [ ] 05-05: Ads campaigns UI (campaigns table + create-from-template modal + detail modal + metrics + sync)

### Phase 6: Email/SMS and analytics

**Goal:** BSM delivers measurable ROI that clients can point to when justifying the subscription.
**Depends on:** Phase 4 (client dashboard for displaying analytics)
**Research:** Unlikely (SendGrid and Twilio are well-documented)

**Scope:**
- Email automation via SendGrid (post-repair follow-up, seasonal campaigns)
- SMS automation via Twilio (review requests, appointment reminders)
- BigQuery analytics pipeline (lead attribution, ROI reporting)
- Analytics dashboard with plain-language summaries
- PSG Value Meter (estimated time and cost savings)

**Plans:**
- [ ] 06-01: Email automation (SendGrid)
- [ ] 06-02: SMS automation (Twilio)
- [ ] 06-03: Analytics pipeline and dashboard
- [ ] 06-04: PSG Value Meter

### Phase 7: Intelligence and scale

**Goal:** BSM becomes the intelligence layer for collision repair marketing.
**Depends on:** Phase 4 (client platform), Phase 6 (analytics data)
**Research:** Likely (RAG architecture, vector database selection, multi-tenant knowledge base)
**Research topics:** Qdrant vs Supabase pgvector for RAG, trend intelligence data sources

**Scope:**
- PSG Intelligence Chatbot (RAG over PSG frameworks, client data, trends)
- Knowledge Base management
- Trend Intelligence Agent (weekly market scanning)
- Multi-Location tier ($1,499/mo + per-location)
- Open integration registry
- Adjacent NAICS expansion (automotive glass, general repair)

**Plans:**
- [ ] 07-01: RAG chatbot and knowledge base
- [ ] 07-02: Trend Intelligence Agent
- [ ] 07-03: Multi-Location tier and integration registry
- [ ] 07-04: Adjacent NAICS expansion

---
*Roadmap created: 2026-04-11*
*Last updated: 2026-04-11*
