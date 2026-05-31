# BSM (Body Shop Marketer)

## What This Is

Four AI agents (web scraper, SEO auditor, market researcher, content writer) that collaborate to continuously optimize collision repair shop websites. The agents monitor local markets, audit SEO performance, identify content opportunities, and produce optimized content. They work as peers that invoke each other on demand, not as a fixed pipeline. The system starts as an internal PSG tool and scales into a customer-facing SaaS product.

## Core Value

Collision repair shops get continuous, data-driven marketing optimization without hiring agencies or learning marketing themselves.

## Current State

| Attribute | Value |
|-----------|-------|
| Type | Application |
| Version | 0.0.0 |
| Status | Initializing |
| Last Updated | 2026-04-11 |

## Requirements

### Core Features

- Four collaborative AI agents: web scraper (exists), SEO auditor, market researcher, content writer
- Smart shop onboarding: name + address input, auto-discover website/phone/hours/reviews/competitors via Google Business Profile API and BigQuery geodata
- Competitor intelligence: BigQuery geodata query within configurable service radius, ranked by proximity/ratings/visibility
- Content production pipeline: agents produce drafts, humans review in Sanity, approved content publishes to client sites
- Agent orchestration via Paperclip AI with per-agent budgets, approval gates, and audit trails

### Validated (Shipped)

None yet.

### Active (In Progress)

None yet.

### Planned (Next)

- Phase 0: Build three remaining agent skills, configure Paperclip, test on existing PSG clients
- Phase 1: Internal operations platform with Paperclip UI and Sanity Studio
- Phase 2: Customer-facing MVP with Next.js dashboard, Supabase Auth, Stripe billing
- Phase 3: Reputation management and Google Ads integration
- Phase 4: Email/SMS automation and analytics dashboard
- Phase 5: RAG chatbot, knowledge base, trend intelligence, multi-location support

### Out of Scope

- Replacing CCC/Mitchell shop management systems (read-only integration at most)
- Unconstrained ChatGPT-style interface (chatbot is bounded by client data and PSG frameworks)
- Full automation without human oversight (dual-approval loop is mandatory for all publishing)

## Target Users

**Primary (Phase 0-1):** PSG internal team
- Account managers running agents across existing collision repair clients
- Need visibility into what agents are doing and ability to review/approve output

**Primary (Phase 2+):** Collision repair shop owners
- Do not have time or expertise for marketing
- Currently paying agencies $2,000-$5,000/month or doing nothing
- Want to see what their marketing is doing and whether it's working

**Secondary:** PSG admin
- Configures agents, manages knowledge base, handles billing
- Oversees all client accounts

## Context

**Business Context:**
PSG has 35 years of collision repair marketing expertise, 8 researched customer personas, and existing LocalReach programmatic SEO technology. The collision repair market is $73.9B across 104,296 US establishments. Over 55% of shops spend less than $5,000/year on marketing. BSM targets $719K ARR in Year 1 (100 shops), scaling to $5.4M ARR by Year 3 (750 shops).

**Technical Context:**
Web scraper skill already exists. Paperclip AI, Claude Flow, Sanity MCP, and Firecrawl MCP are all connected in the current environment. BigQuery contains PSG's geodata warehouse. SEMrush API key is available. Phil Long Collision Center (this repo's neighbor) is a candidate test client.

## Constraints

### Technical Constraints

- Paperclip AI dictates Node.js + PostgreSQL stack (by design, to piggyback on its runtime)
- SEMrush API has request rate limits (need to confirm plan tier capacity)
- Google APIs have per-project quotas (request elevated quotas before scaling beyond 10 shops)
- Agents must degrade gracefully when integrations are unavailable

### Business Constraints

- Solo builder (Nick) for Phase 0-1; team scales with revenue
- Prove agent system moves metrics on real clients before productizing
- No PII handling until Phase 2+ (CCC/Mitchell integration)
- PSG brand guidelines must be followed in all UI (Authority Palette + Clarity Teal)

## Key Decisions

| Decision | Rationale | Date | Status |
|----------|-----------|------|--------|
| Paperclip AI for orchestration | Org-model coordination, budgets, governance, audit trails out of the box | 2026-04-11 | Active |
| Claude Flow alongside Paperclip | Different layers: business orchestration vs execution coordination | 2026-04-11 | Active |
| Agents as collaborative peers | Better output than sequential pipeline; any agent can invoke any other | 2026-04-11 | Active |
| Filesystem before database | Prove agents work without infrastructure overhead | 2026-04-11 | Active |
| Sanity as content store | Structured content, review workflow, MCP already connected | 2026-04-11 | Active |
| Node.js + PostgreSQL | Piggyback on Paperclip's runtime, one stack | 2026-04-11 | Active |
| BigQuery for competitor intelligence | Existing PSG geodata, solved problem with existing data | 2026-04-11 | Active |
| Smart onboarding | Name + address only required, auto-discover everything else | 2026-04-11 | Active |
| PSG brand with Clarity Teal energy | Designated for SaaS/tech interfaces per brand guidelines | 2026-04-11 | Active |
| Uncodixfy + humanizer constraints | No AI-looking UI or AI-sounding copy | 2026-04-11 | Active |
| Internal proof before productizing | Phase 0-1 on existing clients, no billing | 2026-04-11 | Active |
| Public data only in Phase 0-1 | No PII overhead during proof of concept | 2026-04-11 | Active |

## Success Metrics

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Agent output quality | Content matches brand voice, passes SEO validation, no hallucinated facts | - | Not started |
| Organic traffic lift | Measurable improvement on test client sites within 30 days | - | Not started |
| Content production velocity | 10x current manual output per client | - | Not started |
| Phase 2 paying customers | 25 shops by end of Phase 2 | - | Not started |
| Year 1 ARR | $719K (100 shops) | - | Not started |

## Tech Stack / Tools

| Layer | Technology | Notes |
|-------|------------|-------|
| Orchestration | Paperclip AI | Org model, budgets, governance, approvals, audit trails |
| Agent execution | Claude Flow | Spawning, memory (HNSW), hooks, real-time routing |
| Agent skills | Claude Code Skills | Built via /skillsmith, modular and versionable |
| Frontend (Phase 2+) | Next.js (App Router) + Tailwind + shadcn/ui | PSG brand, Clarity Teal energy palette |
| Auth (Phase 2+) | Supabase Auth | JWT, RLS, role-based access |
| Content store | Sanity | Agent output, review workflow, publishing |
| Database | PostgreSQL | Paperclip embedded (Phase 0), managed (Phase 1+) |
| Analytics | BigQuery | Geodata, competitor intelligence, performance metrics |
| SEO data | SEMrush API | Keywords, audits, competitive analysis |
| Web scraping | Firecrawl MCP | Forums, reviews, competitor sites |
| AI models | Anthropic Claude | Opus/Sonnet/Haiku by task complexity |

## Links

| Resource | URL |
|----------|-----|
| PLANNING.md | apps/apps/bsm/PLANNING.md |
| Vault docs | apps/Obsidian Vault/apps/psg-marketer/ |
| PSG brand assets | apps/- brand-assets/ |
| Paperclip AI | https://github.com/paperclipai/paperclip |

---
*PROJECT.md — Updated when requirements or context change*
*Last updated: 2026-04-11*
