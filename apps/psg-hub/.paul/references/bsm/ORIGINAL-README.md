# BSM (Body Shop Marketer)

AI agent system that continuously optimizes collision repair shop websites. Four specialist agents (web scraper, SEO auditor, market researcher, content writer) collaborate to monitor markets, audit performance, identify opportunities, and produce optimized content without manual intervention.

**Type:** Application
**Skill Loadout:** /skillsmith, /paul, /aegis, ui-ux-pro-max, uncodixfy, humanizer
**Quality Gates:** agent output quality, test coverage (80%), security scan (OWASP Top 10), WCAG AA, LCP < 2s, PSG brand compliance

---

## Overview

PSG has 35 years of collision repair marketing expertise. BSM packages that expertise into four AI agents that run collaboratively across client websites. The agents are peers, not a pipeline. Any agent can invoke any other agent depending on the task.

The system starts as an internal PSG tool running on existing clients. Once the agents prove they can move organic traffic and rankings, BSM becomes a customer-facing SaaS product with tiered pricing ($199-$999/month).

**Agents:**
- Web scraper: monitors forums, review sites, and social media for sentiment and trending topics
- SEO auditor: watches technical performance, keyword rankings, and competitor visibility
- Market researcher: synthesizes scraper and auditor data into content opportunity briefs
- Content writer: produces optimized content (blog posts, service pages, meta descriptions) matched to client brand voice

**Smart shop onboarding:** enter a shop name and address. The system auto-discovers website, phone, hours, reviews, social profiles, and competitors (via BigQuery geodata within service radius). Admin corrects and fills gaps.

---

## Stack

| Layer | Choice |
|-------|--------|
| Orchestration | Paperclip AI (org model, budgets, governance, approvals, audit trails) |
| Agent execution | Claude Flow (spawning, memory, hooks, real-time routing) |
| Agent skills | Claude Code Skills (built via /skillsmith) |
| Frontend (Phase 2+) | Next.js (App Router) + Tailwind + shadcn/ui |
| Auth (Phase 2+) | Supabase Auth (JWT, RLS, role-based access) |
| Content store | Sanity (agent output, review, publishing) |
| Database | PostgreSQL (Paperclip embedded for Phase 0, managed for production) |
| Analytics | BigQuery (existing PSG warehouse, geodata, competitor intelligence) |
| SEO data | SEMrush API |
| Web scraping | Firecrawl MCP |
| AI models | Anthropic Claude (opus/sonnet/haiku by task complexity) |

---

## Data model

Core entity is Shop. Everything connects to it.

- **Shop** (name, address, website, phone, hours, services, certifications, review profiles, social profiles, SEO baseline)
- **Competitor** (auto-discovered from BigQuery geodata within service radius, ranked by proximity, ratings, visibility)
- **ContentItem** (agent-produced content with status tracking, linked to Sanity document)
- **ContentBrief** (produced by market researcher, consumed by content writer)
- **AuditReport** (technical SEO, content gaps, competitor comparisons)
- **SentimentReport** (forum/review sentiment by topic)
- **AgentConfig** (which agents are active, schedule, budget per shop)

Phase 0: structured JSON files in filesystem. Phase 1+: PostgreSQL.

---

## API surface

- Phase 0: no API. Agents are Claude Code skills invoked directly.
- Phase 1: Paperclip's built-in REST API for task/agent management.
- Phase 2+: custom REST API with Supabase Auth. Routes for shops, content, audits, agents, onboarding. RLS enforces tenant isolation.

Auth roles: owner (shop client), manager (PSG account manager), admin (PSG admin).

---

## Architecture

```
Paperclip AI (orchestration: roles, budgets, approvals, audit trails)
    |
    +-- Claude Flow (execution: agent spawning, memory, hooks)
    |       |
    |       +-- Web Scraper (Firecrawl MCP)
    |       +-- SEO Auditor (SEMrush API, Search Console)
    |       +-- Market Researcher (scraper + auditor data synthesis)
    |       +-- Content Writer (Sanity output, brand voice matching)
    |
    +-- BigQuery (geodata, competitor discovery, analytics)
    +-- Sanity (content store, review workflow, publishing)
    +-- PostgreSQL (shop data, agent state, task history)
```

Agents are collaborative peers. The content writer can ask the SEO auditor for keyword targets mid-draft. The market researcher can ask the scraper for recent sentiment on demand.

---

## UI/UX

PSG brand system applied throughout. Authority Palette (Foundation Navy #1E3A52, Iron #4A4E57, Canvas #F8F6F3) at 85%. Clarity Teal energy (#0EA5A5, #D4A847, #E6F7F7) at 15%.

Typography: Outfit (headings, 600/700) + Inter (body/UI, 400/500/600).

Design constraints: uncodixfy rules (no glassmorphism, no floating panels, no pill buttons, no decorative copy, no metric-card grids, no fake charts). Think Linear/Stripe, not generic AI dashboard.

Copy constraints: humanizer rules + PSG brand voice (calm, direct, specific, no filler).

Key views: shop onboarding (smart defaults), shop profile, competitor landscape, agent activity feed, content review queue, SEO audit dashboard, client dashboard (Phase 2), admin panel (Phase 2).

---

## Deployment

- Phase 0: local laptop. Paperclip + embedded PostgreSQL. Agents run in terminal.
- Phase 1: single server (CCX43 or Railway). Managed PostgreSQL. Sanity Studio for content review.
- Phase 2+: Vercel (frontend) + Railway (Paperclip server) + Supabase (auth/db) + Sanity (content). GitHub Actions CI/CD.

---

## Security

Phase 0-1: all public/aggregate data. No PII. No encryption or masking requirements.

Phase 2+: if CCC/Mitchell integration happens, PII enters the system. Column-level encryption, PII masking before LLM calls, audit logging on PII access. Designed for now, implemented when needed.

Paperclip provides immutable audit trails and per-agent budget controls. SOC 2 readiness from the orchestration layer.

---

## Implementation phases

### Phase 0: Agent engine (internal, no UI)
Build three agent skills (SEO auditor, market researcher, content writer). Configure Paperclip. Wire integrations. Smart shop onboarding. Test on 2-3 existing PSG clients.

### Phase 1: Internal operations platform
Paperclip React UI for PSG account managers. Shop profile management. Content review via Sanity Studio. Agent scheduling. Migrate to PostgreSQL.

### Phase 2: Customer-facing MVP
Next.js client dashboard. Supabase Auth with RLS. Multi-tenant. Dual approval workflow. Stripe billing (Essentials $199/mo, Growth $499/mo).

### Phase 3: Reputation and ads
Review monitoring. AI review responses. Google Ads integration. Performance tier ($999/mo).

### Phase 4: Email/SMS and analytics
SendGrid email automation. Twilio SMS. BigQuery analytics pipeline. ROI dashboard. PSG Value Meter.

### Phase 5: Intelligence and scale
RAG chatbot over PSG frameworks. Knowledge Base management. Trend Intelligence Agent. Multi-Location tier. Adjacent NAICS expansion.

---

## Design decisions

1. Paperclip over custom orchestration (governance and audit trails out of the box)
2. Claude Flow alongside Paperclip (different layers: business vs execution)
3. Agents as collaborative peers, not a pipeline (better output quality)
4. Filesystem before database (prove agents work, no infrastructure overhead)
5. Sanity as content store (structured content, review workflow, MCP connected)
6. Node.js + PostgreSQL (piggyback on Paperclip's stack)
7. BigQuery for competitor intelligence (existing PSG geodata)
8. Smart onboarding over form-heavy intake (name + address, auto-discover rest)
9. PSG brand system with Clarity Teal energy (designated for SaaS/tech)
10. Uncodixfy + humanizer as design constraints (no AI aesthetics)
11. Prove internally before productizing (Phase 0-1 on existing clients)
12. Public/aggregate data only in Phase 0-1 (no PII overhead during proof of concept)

---

## Open questions

1. BigQuery geodata schema: confirm table/field names for competitor discovery
2. Which PSG clients for Phase 0 testing beyond Phil Long?
3. Paperclip heartbeat cadence per agent type
4. Sanity project setup: new or existing PSG organization?
5. SEMrush API rate limits vs projected agent volume
6. Google Search Console / GBP OAuth access for client sites
7. Content publishing destination after approval (WordPress, Sanity frontend, manual handoff)

---

## References

- PLANNING.md: `apps/apps/bsm/PLANNING.md` (full ideation document)
- Vault docs: `apps/Obsidian Vault/apps/psg-marketer/` (platform brief, PRD, project plan, roadmap, technical architecture)
- PSG brand: `apps/- brand-assets/` (guidelines PDF, color system, brand persona)
- Phil Long content: `apps/websites/phil-long/content/` (test client)
- Paperclip AI: https://github.com/paperclipai/paperclip
