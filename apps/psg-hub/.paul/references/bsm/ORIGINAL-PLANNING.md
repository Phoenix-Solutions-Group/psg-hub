# BSM (Body Shop Marketer)

> AI agent system that continuously optimizes collision repair shop websites through collaborative specialist agents, starting as an internal PSG tool and scaling into a customer-facing SaaS product.

**Created:** 2026-04-11
**Type:** Application
**Stack:** Node.js + PostgreSQL (Paperclip) | Next.js + Tailwind + shadcn/ui | Supabase | Sanity | BigQuery
**Skill Loadout:** /skillsmith (agent creation), /paul (managed build), /aegis (security audit), ui-ux-pro-max (design system), uncodixfy (UI quality), humanizer (copy quality)
**Quality Gates:** test coverage, security scan, WCAG AA accessibility, Lighthouse performance, brand compliance

---

## Problem statement

Collision repair shop owners do not have time to learn marketing. They either hire agencies that apply generic tactics at $2,000-$5,000/month or they do nothing. The result is weak search visibility, stale content, and zero insight into what their local market actually needs.

PSG has 35 years of collision repair marketing expertise. The problem is delivering that expertise at scale without proportional labor costs. Four AI agents working collaboratively can monitor local markets, audit SEO, identify content opportunities, and produce optimized content continuously across dozens of client sites. No human marketer can sustain that pace or consistency.

**Who it's for:**
- Phase 0-1: PSG internal team, running agents across existing collision repair clients
- Phase 2+: Shop owners who subscribe to BSM as a SaaS product

**Why build vs buy:** Nothing in this vertical combines AI content generation with collision repair domain expertise, SEMrush-grade SEO auditing, local competitor intelligence, and forum/review sentiment monitoring in a single coordinated system. Horizontal tools (Jasper, SurferSEO, MarketMuse) lack the vertical knowledge. Vertical tools (Podium, Steer, BodyShop Booster) lack the AI content engine. PSG's advantage is domain depth plus the willingness to prove it on real clients before productizing.

---

## Tech stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Orchestration | Paperclip AI | Org-model agent coordination, per-agent budgets, governance, approval gates, audit trails. Node.js + PostgreSQL native. |
| Agent execution | Claude Flow | Session-level agent spawning, memory (HNSW), hooks, real-time task routing within execution contexts. |
| Agent skills | Claude Code Skills (via /skillsmith) | Each specialist agent is a Claude Code skill with defined expertise and tool access. Modular, testable, versionable. |
| Frontend (Phase 2+) | Next.js (App Router) + Tailwind + shadcn/ui | SSR for public-facing pages, component library matches PSG brand system, strong Vercel deployment path. |
| Auth (Phase 2+) | Supabase Auth | JWT, RLS, role-based access. Carries forward from existing PSG infrastructure. |
| Content store | Sanity | Agent-produced content flows into Sanity for review and publishing. Structured content model, MCP server already connected. |
| Database | PostgreSQL (Paperclip embedded for Phase 0, managed for production) | Paperclip's native database. Shop profiles, agent state, task history, approvals. |
| Analytics warehouse | BigQuery | Existing PSG data warehouse. Geodata for competitor identification, SEMrush keyword data, performance metrics. |
| SEO data | SEMrush API | Keyword research, competitive analysis, site audits, trend signals. API key available. |
| Web scraping | Firecrawl MCP | Forum monitoring, review scraping, competitor site analysis. MCP server already connected. |
| AI models | Anthropic Claude | claude-opus-4-6 for complex content, claude-sonnet-4-6 for standard generation, claude-haiku-4-5 for classification and short-form. |

### Research needed

- Paperclip's heartbeat system configuration for collision repair agent cadence (daily scraping, weekly audits, continuous content)
- BigQuery geodata schema: confirm what shop location data exists and what needs to be enriched
- Sanity content model design for agent-produced content types (blog posts, service pages, meta descriptions, audit reports)
- CCC/Mitchell API feasibility for Phase 2+ customer data integration

---

## Data model

### Entities

| Entity | Key Fields | Relationships |
|--------|-----------|---------------|
| Shop | id, name, address, city, state, zip, phone, website_url, google_business_profile_url, hours, service_radius_miles | has many Competitors, ContentItems, AuditReports, AgentConfigs, ReviewProfiles, SocialProfiles |
| Competitor | id, shop_id, name, address, distance_miles, google_rating, review_count, website_url, visibility_score | belongs to Shop (auto-discovered via BigQuery geodata) |
| ContentItem | id, shop_id, type, title, body, target_keywords[], status, created_by_agent, reviewed_by, published_at, sanity_document_id | belongs to Shop, linked to Sanity document |
| AuditReport | id, shop_id, type (technical_seo, content_gap, competitor), findings[], recommendations[], created_at | belongs to Shop |
| AgentConfig | id, shop_id, agent_type, active, schedule, budget_monthly, last_run_at | belongs to Shop |
| ReviewProfile | id, shop_id, platform, url, current_rating, review_count, last_scraped_at | belongs to Shop |
| SocialProfile | id, shop_id, platform, url | belongs to Shop |
| SentimentReport | id, shop_id, source, topic, sentiment_score, trending_topics[], created_at | belongs to Shop |
| ContentBrief | id, shop_id, topic, target_keywords[], competitor_gap, audience_persona, priority_score, status | belongs to Shop (produced by market researcher, consumed by content writer) |

### Shop auto-discovery fields

When an admin enters just a shop name and address, the system attempts to populate:
- website_url (Google Business Profile API lookup)
- phone (same source)
- hours (same source)
- google_business_profile_url (same source)
- services[] (scraped from website if URL found)
- certifications[] (scraped from website, cross-referenced with I-CAR/OEM databases)
- review_profiles[] (discovered across Google, Yelp, Facebook, Carwise, BBB)
- social_profiles[] (discovered from website or GBP listing)
- seo_baseline (SEMrush domain overview if website found)
- competitors[] (BigQuery geodata query within service radius)

### Notes

- Phase 0: Shop data stored as structured JSON files in `apps/apps/bsm/shops/{shop-slug}/`
- Phase 1+: Shop data migrates to PostgreSQL with Paperclip managing the schema
- ContentItem has dual storage: structured metadata in PostgreSQL, full content body in Sanity
- Competitor discovery is re-run monthly or on admin request to catch new entrants

---

## API surface

### Phase 0: No traditional API

Agents are Claude Code skills invoked directly. Data flows through the filesystem and Paperclip's internal task system. No HTTP endpoints.

### Phase 1: Paperclip's built-in API

Paperclip exposes its own REST API for task management, agent status, and approval workflows. No custom API layer needed.

### Phase 2+: Custom API for client dashboard

#### Auth strategy

Supabase Auth with JWT tokens. Role-based access control:
- `owner` (shop owner/client): sees their shop only, can approve/reject content, view reports
- `manager` (PSG account manager): sees assigned client shops, can review and edit agent output
- `admin` (PSG admin): sees all shops, can configure agents, manage knowledge base, access billing

RLS policies on PostgreSQL enforce tenant isolation at the database level.

#### Route groups

| Group | Methods | Auth | Purpose |
|-------|---------|------|---------|
| /api/shops | GET, POST, PATCH | admin, manager | Shop CRUD, onboarding |
| /api/shops/:id/competitors | GET, POST, DELETE | admin, manager | Competitor list management |
| /api/shops/:id/content | GET | owner, manager, admin | Content items for a shop |
| /api/shops/:id/content/:id/approve | POST | owner, manager | Approve or reject content |
| /api/shops/:id/audits | GET | owner, manager, admin | SEO audit reports |
| /api/shops/:id/sentiment | GET | manager, admin | Sentiment and trend reports |
| /api/shops/:id/agents | GET, PATCH | admin | Agent configuration |
| /api/onboard | POST | admin | Smart onboarding (name + address, auto-discover rest) |

#### Internal vs external

- Public endpoints: none in Phase 2 MVP (all authenticated)
- Internal/admin endpoints: agent configuration, knowledge base management, billing
- MCP integration points: Sanity MCP (content CRUD), Firecrawl MCP (scraping), Claude Flow MCP (agent coordination)

---

## Deployment strategy

### Phase 0: Local development

Paperclip runs locally via `npx paperclipai onboard --yes`. Embedded PostgreSQL. Agents run as Claude Code skills in the terminal. Output goes to filesystem.

No Docker, no cloud infrastructure. Just a laptop and API keys.

### Phase 1: Single server

| Component | Runtime | Purpose |
|-----------|---------|---------|
| Paperclip server | Node.js on CCX43 or Railway | Orchestration, agent scheduling, approval workflows |
| PostgreSQL | Managed (Supabase or Railway) | Shop data, agent state, task history |
| Sanity Studio | Hosted (sanity.io) | Content review and publishing interface |
| BigQuery | Google Cloud (existing) | Geodata queries, analytics warehouse |

### Phase 2+: Production

| Component | Runtime | Purpose |
|-----------|---------|---------|
| Next.js frontend | Vercel | Client dashboard, admin portal |
| Paperclip server | Railway or CCX43 | Orchestration layer |
| Supabase | Managed | Auth, PostgreSQL, RLS |
| Sanity | Managed | Content store and delivery |
| BigQuery | Google Cloud | Analytics and geodata |
| Redis | Railway | Task queue, session cache |

CI/CD: GitHub Actions to Vercel (frontend) + Railway (backend). Preview deployments on PRs.

---

## Security considerations

- **Auth/authz model:** Supabase Auth (JWT) with RLS. Every query scoped to `shop_id` at the database level. Cross-tenant data access is architecturally impossible once RLS is in place.
- **Data sensitivity (Phase 0-1):** All public/aggregate data. No PII. No customer records. Agents work with keywords, rankings, review sentiment, and forum posts. No encryption or masking requirements at this stage.
- **Data sensitivity (Phase 2+):** If CCC/Mitchell integration happens, PII enters the system. At that point: column-level encryption in PostgreSQL, PII masking before any LLM call, audit logging on all PII access. Design for this now, implement when needed.
- **API keys and secrets:** SEMrush API key, Anthropic API key, Google API credentials stored in environment variables. Never committed to source. Paperclip's credential management for per-shop OAuth tokens (Google Business Profile, Search Console).
- **Agent budget controls:** Paperclip's per-agent monthly budgets prevent runaway token spend. Hard caps enforced at the orchestration layer.
- **Rate limiting:** SEMrush API has request limits. Agents must respect rate limits with exponential backoff. Google APIs have per-project quotas. Request elevated quotas before scaling beyond 10 shops.
- **Audit trails:** Paperclip provides immutable logs of every agent action, approval decision, and content publish. SOC 2 readiness built in from day one.

---

## UI/UX needs

### Design system

PSG brand guidelines applied throughout. No generic AI dashboard aesthetics.

**Color system (Authority Palette + Clarity Teal energy):**

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-canvas` | #F8F6F3 | Page backgrounds, breathing space. Never pure white. |
| `--text-primary` | #1E3A52 | Foundation Navy. Headers, navigation, primary text on light backgrounds. |
| `--text-secondary` | #4A4E57 | Iron. Secondary text, borders, subtle UI elements. |
| `--accent-primary` | #0EA5A5 | Clarity teal. Primary interactive elements, links, active states. |
| `--accent-secondary` | #D4A847 | Catalyst gold. Secondary accent, value indicators, success states. |
| `--surface-light` | #E6F7F7 | Horizon. Light teal surface for cards, highlights. |
| `--heritage` | #B8483E | Phoenix Red. Phoenix icon only. Heritage references only. Use sparingly. |
| `--bg-nav` | #1E3A52 | Foundation Navy. Sidebar background. |
| `--text-on-dark` | #F8F6F3 | Canvas. Text on Foundation Navy backgrounds. |

**Color rules:**
- Authority Palette (Navy, Iron, Canvas) dominates at 85%
- Clarity Teal energy at 15% max
- One energy palette per interface. Never mix Clarity/Trust/Ignite.
- Phoenix Red reserved for the bird icon and heritage references

**Typography:**
- Headings: Outfit (Google Fonts), weights 600/700
- Body/UI: Inter (Google Fonts), weights 400/500/600
- H1: 48px/700, H2: 36px/600, H3: 24px/600, Body: 16px/400, Small: 14px/400, Caption: 12px/500
- Line height: 1.2 for headings, 1.6 for body

**Component constraints (uncodixfy):**
- Sidebar: 240-260px fixed width, solid Foundation Navy background, simple border-right, no floating shells
- Cards: 8-12px border radius max, subtle 1px borders, shadows max 0 2px 8px rgba(0,0,0,0.1)
- Buttons: solid fills or simple borders, 8-10px radius max, no pill shapes, no gradients
- No glassmorphism, no floating panels, no decorative blobs, no hero sections inside the dashboard
- No eyebrow labels, no uppercase letter-spaced labels, no decorative copy explaining what the UI does
- No metric-card grid as the default dashboard layout
- No fake charts that exist only to fill space
- Transitions: 100-200ms ease, no bouncy animations, no transform hover effects

**Copy constraints (humanizer + PSG brand voice):**
- Calm, direct, specific. No filler phrases.
- No em dashes in UI copy (use commas or new sentences)
- No "streamline," "harness," "leverage," "seamless," "cutting-edge," "empower"
- No promotional inflation. State what the system does, not how impressive it is.
- Error messages state cause and how to fix. Not "Something went wrong."
- Empty states offer a clear next action. Not decorative illustrations with vague encouragement.

### Key views

| View | Purpose | Phase | Complexity |
|------|---------|-------|------------|
| Shop onboarding | Smart intake: name + address, system discovers the rest | Phase 1 (Paperclip UI), Phase 2 (custom) | Medium |
| Shop profile | Editable shop details, auto-discovered data with override capability | Phase 1 | Medium |
| Competitor landscape | Map or list of competitors within service radius, sourced from BigQuery geodata | Phase 1 | Medium |
| Agent activity feed | What each agent is doing, has done, and has queued | Phase 1 (Paperclip native) | Low |
| Content review queue | Agent-produced content awaiting human approval | Phase 1 (Sanity Studio), Phase 2 (custom) | Medium |
| SEO audit dashboard | Technical issues, keyword gaps, competitor comparisons | Phase 2 | High |
| Client dashboard | "What is PSG doing for me" view. Recent activity, content published, rankings moved. | Phase 2 | High |
| Admin panel | All shops, agent configs, budgets, knowledge base management | Phase 2 | High |

### Responsive needs

Desktop-first. The admin and account manager interfaces are used on desktop. Client dashboard (Phase 2) should be responsive for shop owners checking on their phone, but desktop is primary.

---

## Integration points

| Integration | Type | Direction | Purpose | Auth | Phase |
|------------|------|-----------|---------|------|-------|
| Firecrawl | MCP server | Read | Forum scraping, review monitoring, competitor site analysis | MCP connection (existing) | 0 |
| SEMrush | REST API | Read | Keyword data, site audits, competitive intelligence, trend signals | API key | 0 |
| Google Search Console | REST API | Read | Organic search performance, indexing status, sitemap submission | OAuth per shop | 1 |
| Google Business Profile | REST API | Read | Shop discovery (name/address lookup), reviews, hours, photos | OAuth per shop | 1 |
| Sanity | MCP server + API | Read/Write | Content store for agent output, review workflow, publishing | MCP connection (existing) + API token | 0 |
| BigQuery | REST API | Read | Geodata for competitor identification, analytics warehouse | Service account | 0 |
| Anthropic Claude | SDK | Read/Write | LLM calls for all four agents (content generation, analysis, classification) | API key | 0 |
| Paperclip AI | Node.js server | Internal | Agent orchestration, task routing, budgets, approvals, audit trails | Local (Phase 0), API (Phase 1+) | 0 |
| Claude Flow | MCP server | Internal | Agent spawning, memory, hooks, execution coordination | MCP connection (existing) | 0 |
| Supabase | SDK | Read/Write | Auth, PostgreSQL, RLS, client-facing data | Project credentials | 2 |
| Google Ads | REST API | Read/Write | Campaign management, performance data | OAuth per shop | 3+ |
| Twilio | REST API | Write | SMS campaigns, post-repair follow-up | API key | 3+ |
| SendGrid | REST API | Write | Email campaigns, transactional email | API key | 3+ |
| Stripe | SDK | Read/Write | Subscription billing, tier enforcement | API key | 2 |

### Failure handling

- If an integration is down, the agent that depends on it logs the failure and continues with whatever data is available from other sources
- No silent failures. Paperclip's audit trail records every integration call and its result
- Agents are designed to degrade gracefully: the content writer can produce content without SEMrush data (it just won't be keyword-optimized), the scraper can work without Firecrawl (it just won't have forum data)

---

## Phase breakdown

### Phase 0: Agent engine (internal, no UI)

**Build:**
- Create three Claude Code skills via /skillsmith: SEO auditor, market researcher, content writer (web scraper skill exists)
- Configure Paperclip with four agent roles, org hierarchy, and budget limits
- Build shop profile schema (structured JSON in filesystem)
- Wire SEMrush API integration into SEO auditor and market researcher
- Wire Firecrawl MCP into web scraper
- Wire Sanity MCP into content writer for output storage
- Build BigQuery competitor discovery query (geodata within service radius)
- Smart shop onboarding: name + address input, auto-discover website/phone/hours/reviews/competitors

**Testable:**
- Run all four agents against 2-3 existing PSG collision repair clients (Phil Long is a candidate)
- Verify scraper produces sentiment reports from forums and review sites
- Verify SEO auditor produces actionable technical audit and keyword gap analysis
- Verify market researcher synthesizes scraper + SEO data into content briefs
- Verify content writer produces draft content that matches client brand voice
- Verify agents can invoke each other (content writer asks SEO auditor for keyword targets mid-draft)
- Verify competitor discovery returns accurate results from BigQuery geodata

**Outcome:**
- PSG can point the system at a client site and get a content brief + draft content within hours, not weeks
- Measurable: did organic traffic or rankings move for test clients after 30 days of agent-produced content?

### Phase 1: Internal operations platform

**Build:**
- Paperclip React UI configured for PSG account managers
- Shop profile management (view, edit, override auto-discovered data)
- Competitor landscape view (list with distance, ratings, review counts)
- Content review workflow: agents produce to Sanity, PSG reviews in Sanity Studio, approves for publishing
- Agent scheduling: configure which agents run, how often, for which shops
- Migrate shop data from filesystem to PostgreSQL
- Google Search Console and Google Business Profile OAuth integration per shop

**Testable:**
- PSG account manager can onboard a new shop by entering name + address
- System auto-discovers shop details and competitors
- Agent output appears in Sanity Studio for review
- Account manager can approve, edit, or reject content
- Approved content publishes to client website via Sanity

**Outcome:**
- PSG runs the agent system across all collision repair clients from a single internal dashboard
- Content production velocity increases without adding headcount

### Phase 2: Customer-facing MVP

**Build:**
- Next.js client dashboard (PSG brand, Clarity Teal energy palette, uncodixfy constraints)
- Supabase Auth with role-based access (owner, manager, admin)
- Multi-tenant PostgreSQL with RLS (shop_id scoping)
- Client onboarding wizard (smart defaults, minimal required input)
- Client dashboard: recent activity, content published, rankings changed, agent status
- Dual approval workflow: agent produces, PSG reviews, client approves, system publishes
- Stripe billing integration with Essentials ($199/mo) and Growth ($499/mo) tiers
- Tier enforcement: agent count and content volume gated by subscription level

**Testable:**
- Shop owner can log in and see what the agents are doing for their business
- Shop owner can approve or request changes to content before it goes live
- Billing works: signup, upgrade, downgrade, cancellation
- Tenant isolation: shop A cannot see shop B's data

**Outcome:**
- BSM is a product someone pays for
- First external paying customers onboarded

### Phase 3: Reputation and ads

**Build:**
- Reputation Command Center: review monitoring across Google, Yelp, Facebook, Carwise
- AI review response drafts (tone-matched per platform)
- Google Ads integration: campaign templates for collision repair keywords
- Ads performance dashboard
- Performance tier ($999/mo) with managed ads and full agent suite

**Testable:**
- Reviews from all platforms appear in a single inbox
- AI drafts responses that match the shop's voice
- Google Ads campaigns can be created from templates and monitored

**Outcome:**
- BSM covers the full marketing stack for collision repair: content, SEO, reputation, and paid search

### Phase 4: Email/SMS and analytics

**Build:**
- Email automation via SendGrid (post-repair follow-up sequences, seasonal campaigns)
- SMS automation via Twilio (review requests, appointment reminders)
- BigQuery analytics pipeline: lead attribution, ROI reporting
- Analytics dashboard with plain-language summaries
- PSG Value Meter (estimated time and cost savings displayed to client)

**Testable:**
- Post-repair email sequence triggers automatically from shop management system data
- Analytics dashboard shows real data with accurate attribution
- Client can see the dollar value of what BSM is doing for them

**Outcome:**
- BSM delivers measurable ROI that clients can point to when justifying the subscription

### Phase 5: Intelligence and scale

**Build:**
- PSG Intelligence Chatbot (RAG over PSG frameworks, client data, trend intelligence)
- Knowledge Base management (Qdrant or Supabase pgvector)
- Trend Intelligence Agent (weekly market scanning, framework gap identification)
- Multi-Location tier ($1,499/mo + per-location)
- Open integration registry (admin-configurable API connections)
- Adjacent NAICS expansion (automotive glass, general repair)

**Testable:**
- Client can ask questions about their business data and get cited answers
- Trend agent identifies gaps in PSG's marketing frameworks
- Multi-location shops see roll-up view across all sites

**Outcome:**
- BSM becomes the intelligence layer for collision repair marketing, not just an execution tool

---

## Skill loadout and quality gates

### Skills used during build

| Skill | When | Purpose |
|-------|------|---------|
| /skillsmith | Phase 0 | Build the four specialist agent skills |
| /paul | All phases | Managed build workflow (plan, execute, verify per phase) |
| /aegis | Phase 2+ | Security audit before customer-facing launch |
| ui-ux-pro-max | Phase 2+ | Design system generation, component quality, accessibility |
| uncodixfy | Phase 2+ | Prevent generic AI dashboard aesthetics |
| humanizer | All phases | Ensure agent-produced content and UI copy sounds human |
| /collision-repair-content-system | Phase 0+ | Collision repair content creation workflow (if applicable) |

### Quality gates

| Gate | Threshold | When |
|------|-----------|------|
| Agent output quality | Content matches client brand voice, passes SEO validation, contains no hallucinated facts | Phase 0 (manual review) |
| Test coverage | 80% on API routes and data layer | Phase 2+ |
| Security scan | Pass OWASP Top 10, RLS policy audit, no plaintext credentials | Phase 2 (before customer launch) |
| Accessibility | WCAG AA on all client-facing views | Phase 2+ |
| Performance | LCP < 2s, CLS < 0.1 on client dashboard | Phase 2+ |
| Brand compliance | PSG color system, typography, and voice guidelines followed | Phase 2+ |

---

## Design decisions

1. **Paperclip over custom orchestration**: Paperclip provides org-model agent coordination, budgets, governance, and audit trails out of the box. Building a custom orchestrator would take months and still lack the governance features BSM needs for SOC 2 readiness.

2. **Claude Flow alongside Paperclip**: Paperclip handles business-level orchestration (who does what, budgets, approvals). Claude Flow handles execution-level coordination (spawning agents, sharing memory, routing within a session). Different layers, complementary.

3. **Agents as collaborative peers, not a pipeline**: The four agents can invoke each other on demand. The content writer asks the SEO auditor for keyword targets. The market researcher asks the scraper for recent sentiment. This produces better output than a sequential handoff.

4. **Filesystem before database**: Phase 0 uses structured JSON/markdown files. No infrastructure overhead. Proves the agent system works before investing in deployment.

5. **Sanity as content store**: Agent-produced content lands in Sanity, not a custom CMS. Sanity handles structured content, review workflows, and publishing. MCP server is already connected.

6. **Node.js + PostgreSQL (Paperclip's stack)**: Piggyback on Paperclip's runtime instead of introducing Python/FastAPI as a separate layer. One stack, fewer moving parts.

7. **BigQuery for competitor intelligence**: PSG already has geodata in BigQuery. Querying for shops within a service radius and ranking them by visibility is a solved problem with existing data.

8. **Smart onboarding over form-heavy intake**: The system should require only a name and address to get started. Everything else (website, phone, reviews, competitors) is auto-discovered. Admin corrects and fills gaps, not the other way around.

9. **PSG brand system (Clarity Teal energy)**: BSM is a PSG product. The Clarity System (teal) is designated for technology solutions and SaaS interfaces. Authority Palette at 85%, Clarity at 15%.

10. **Uncodixfy + humanizer as design constraints**: Every UI view and every piece of agent-produced copy runs against these anti-AI-pattern filters. The product should look and sound like humans built it and wrote for it.

11. **Prove internally before productizing**: Phase 0-1 runs on existing PSG clients. No billing, no onboarding wizard, no multi-tenancy. Prove the agents move metrics before selling access.

12. **Public/aggregate data only in Phase 0-1**: No PII until CCC/Mitchell integration in Phase 2+. This eliminates encryption, masking, and compliance overhead during the proof-of-concept.

---

## Open questions

1. What BigQuery tables/schemas contain the collision repair shop geodata? Need to confirm field names and coverage before building the competitor discovery query.
2. Which PSG collision repair clients are best candidates for Phase 0 testing? Phil Long is in this repo. Who else?
3. Paperclip's heartbeat cadence: what's the right schedule for each agent? Daily scraping? Weekly audits? Continuous content generation?
4. Sanity project setup: new project for BSM content, or use an existing PSG Sanity organization?
5. SEMrush API rate limits and plan tier: does the current plan support the volume of API calls four agents will generate across multiple client sites?
6. Does PSG have existing Google Search Console and Google Business Profile access for client sites, or does each client need to grant OAuth access?
7. Content publishing destination: when agents produce content and it's approved, where does it go? Client's WordPress? A Sanity-powered frontend? Manual handoff to a developer?

---

## Next actions

- [ ] Run `/skillsmith` to create the SEO auditor agent skill
- [ ] Run `/skillsmith` to create the market researcher agent skill
- [ ] Run `/skillsmith` to create the content writer agent skill
- [ ] Install Paperclip (`npx paperclipai onboard --yes`) and configure the four-agent org structure
- [ ] Build the shop profile JSON schema and create a profile for Phil Long as the first test client
- [ ] Query BigQuery to confirm geodata schema and test competitor discovery for Colorado Springs
- [ ] Wire SEMrush API into the SEO auditor skill
- [ ] Run the full four-agent cycle against Phil Long's site and evaluate output quality

---

## References

- Obsidian vault docs: `apps/Obsidian Vault/apps/psg-marketer/` (7 files: platform brief, PRD, project plan, roadmap, technical architecture, ClaudeKit model analysis, premise challenge responses)
- PSG brand guidelines: `apps/- brand-assets/PSG-Brand-Guidelines-Complete.pdf`
- PSG color system: `apps/- brand-assets/PSG-Color-System-Visualization.png`
- PSG brand persona: `apps/- brand-assets/psg_brand_persona.txt`
- Phil Long content: `apps/websites/phil-long/content/` (existing client site content and SEO research)
- Paperclip AI: https://github.com/paperclipai/paperclip

---

*Last updated: 2026-04-11*

---

**Graduated:** 2026-04-11
**Location:** `apps/apps/bsm/`
**README:** `apps/apps/bsm/README.md`
