# Local Reach Technical Feasibility

Issue: PSG-2035  
Date: 2026-07-17  
Owner: Ada  

## Bottom Line

Local Reach is technically feasible as a BSM extension if the MVP stays conservative:

- Use public, allowed evidence sources only.
- Generate recommendations and draft content inside BSM.
- Route every customer-facing item through the existing BSM content approval path.
- Publish manually in WordPress/Elementor for the pilot.
- Defer SendTIO, Astro, and direct CMS automation until the approval and source-quality controls prove stable.

This avoids the main risks: unsafe scraping, stale content skills, cross-customer data leakage, and accidental live website changes.

## Repo And Tooling Checks Completed

- Read `Reference.md`, `README.md`, and `package.json`.
- Used Graphify before broad code reading:
  - `graphify query "where are BSM profiles content reviews approvals and tenant access implemented" --budget 1800`
  - `graphify query "Local Reach Body Shop Marketer content approvals CMS publishing customer settings evidence links learning feedback" --budget 1800`
- Reviewed the existing implementation patterns:
  - `apps/psg-hub/src/lib/agent-engine/content-writer-run.ts`
  - `apps/psg-hub/src/lib/claim-integrity/*`
  - `apps/psg-hub/src/lib/bsm/content-approvals.ts`
  - `apps/psg-hub/src/lib/shop/context.ts`
  - `apps/psg-hub/supabase/migrations/20260717021500_bsm_content_approval_review_items.sql`
  - `apps/psg-hub/supabase/migrations/20260717023000_bsm_content_approval_visibility.sql`
- Tried to use the PSG knowledge base because the runtime exposed gbrain environment variables, but the local MCP endpoint rejected requests without an authorization token. No gbrain claims are used in this note.

## Skill Freshness Control

The MVP depends on a small set of skills and repo-side gates:

| Dependency | Current observed source | Current observed version | MVP use |
| --- | --- | --- | --- |
| Collision Repair Content System | `/codex-home/skills/content-generator/SKILL.md` | `0.4.0` | Collision-specific research, briefs, copy, quality gates |
| GPT image skill | `/skills-custom/gpt-image/SKILL.md` | `0.1.0` | Optional image generation only after approval |
| Higgsfield skill | `/skills-custom/higgsfield/SKILL.md` | `0.1.0` | Optional higher-end creative only after approval |
| BSM Content Writer gate | `apps/psg-hub/src/lib/agent-engine/content-writer-run.ts` | repo code, not a skill version | Claim-integrity gate before persistence |
| BSM claim integrity | `apps/psg-hub/src/lib/claim-integrity/*` | repo code, not a skill version | Rejects unbacked claims and unsafe assertions |
| BSM content approval | `apps/psg-hub/src/lib/bsm/content-approvals.ts` | repo code, not a skill version | Customer review and approval workflow |

Freshness procedure before each Local Reach release or monthly pilot batch:

1. Read each skill `SKILL.md` frontmatter and record `name`, `version`, and file path in the run log.
2. Compare versions against the last approved Local Reach run. Any version change requires a short regression pass on one sample shop before customer use.
3. For repo-side gates, record the current git commit and run the focused tests covering changed gate or approval code.
4. If a skill has no version or the version is unchanged but the file content changed, treat it as changed and re-run the sample regression.
5. Do not use optional creative/media skills in production content unless the approval record names the generated asset and the customer approves it.

## Source Options Ranked

| Rank | Source path | Legality / policy risk | Reliability | Cost | Usefulness | MVP decision |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | First-party and approved customer facts: shop website, approved intake, Google Business Profile, verified review/rating links, BSM `verified_facts` | Low when customer-approved | High | Low | High | Use as the foundation |
| 2 | SEO and local visibility APIs: Google Search Console, Google Business Profile, SEMrush, Local Falcon, Yext where already connected | Low to medium, governed by API terms | High | Medium; SEMrush has rate and cache limits | High | Use where already available |
| 3 | Competitor public websites through Firecrawl or direct fetch | Medium; honor robots.txt, terms, rate limits, and no login walls | Medium | Low to medium | Medium-high | Use only for public page facts and positioning, not copying content |
| 4 | Public search results and map/local-pack observations | Medium; SERP vendors and search engines restrict automated collection | Medium | Medium | Medium | Use through approved APIs/tools, not ad hoc scraping |
| 5 | Forum/social listening through official APIs or manual excerpts | Medium-high; Reddit and similar platforms require API approval and terms compliance | Medium-low; noisy and anecdotal | Medium | Medium for customer anxieties | Defer broad automation; allow manual, cited research only |
| 6 | Daily competitive-awareness crawls across many sites | High if broad crawling is unmanaged | Medium-low | Medium-high | Medium | Not MVP. Revisit after source registry, rate limits, and audit trail exist |

Operating rules:

- Check `robots.txt` before crawling. RFC 9309 defines the Robots Exclusion Protocol, and Google documents the same pattern for crawler behavior.
- Do not bypass login, paywalls, blocks, CAPTCHAs, or site restrictions.
- Do not collect personal data from forums or reviews unless it is public, minimal, and necessary for an approved business purpose.
- Store evidence as source links and short summaries, not copied pages.
- Treat legal conclusions as operational guardrails, not legal advice.

## MVP WordPress/Elementor Publishing Workflow

Manual publishing is the MVP path because it keeps customer websites safe while Local Reach proves its recommendation quality.

Operator checklist: `docs/local-reach/manual-wordpress-elementor-publishing-checklist.md`.

1. Local Reach creates a recommendation and draft content in BSM.
2. The draft passes the existing BSM claim-integrity gate before it can become a review item.
3. PSG creates a BSM content approval item with:
   - customer/shop id
   - title
   - recommendation type
   - evidence links
   - draft body
   - intended page or post path
   - publication notes
4. Customer approves, rejects, or requests updates in BSM.
5. After approval, PSG manually publishes in WordPress/Elementor:
   - copy text into the target Elementor page/post
   - add meta title/description where the site’s SEO plugin supports it
   - add approved schema only when the page type requires it
   - preview the page before publishing
   - capture final URL and timestamp back into BSM
6. PSG records a post-publish check:
   - live URL works
   - no visible layout break
   - no invented claims
   - approved content matches the live page

WordPress automation remains feasible later because WordPress exposes REST API endpoints for posts and supports application passwords, but Elementor layout fidelity varies by site. That makes manual publishing the right pilot control.

## Future Paths, Not MVP Requirements

- SendTIO: future campaign/distribution path only after PSG confirms API shape, account permissions, customer consent, and unsubscribe/compliance controls.
- Astro: future static-site path for PSG-owned landing pages or microsites, not customer WordPress sites.
- Programmatic WordPress publishing: future path using WordPress REST API, application passwords, and site-specific test environments.
- Programmatic Elementor publishing: future path only after each customer site’s Elementor template structure is mapped and tested on staging.
- Daily competitive-awareness automation: future path after source registry, crawl budget, robots checks, evidence retention, and alert triage exist.

## Proposed Data Model

Use BSM conventions: `shop_id` for customer scope, `profile_id` for people, row-level customer separation, and append-only events for audit history.

Core tables:

- `local_reach_customer_settings`
  - `id`, `shop_id`, `enabled`, `wordpress_site_url`, `publishing_mode` (`manual`, future `api_draft`, future `api_publish`), `default_approval_profile_id`, `location_rules_jsonb`, `created_at`, `updated_at`
- `local_reach_source_registry`
  - `id`, `shop_id`, `source_type`, `source_url`, `allowed_use`, `robots_status`, `terms_note`, `last_checked_at`, `created_at`
- `local_reach_recommendations`
  - `id`, `shop_id`, `location_id`, `recommendation_type`, `title`, `summary`, `priority`, `status` (`draft`, `ready_for_review`, `approved`, `rejected`, `published`, `archived`), `approval_item_id`, `created_by_profile_id`, `created_at`, `updated_at`
- `local_reach_evidence_links`
  - `id`, `recommendation_id`, `source_registry_id`, `url`, `evidence_type`, `summary`, `captured_at`
- `local_reach_location_rules`
  - `id`, `shop_id`, `location_id`, `service_area_jsonb`, `excluded_locations_jsonb`, `competitor_names_jsonb`, `claim_rules_jsonb`, `updated_by_profile_id`, `updated_at`
- `local_reach_approval_status`
  - `id`, `recommendation_id`, `review_item_id`, `decision`, `decision_profile_id`, `decision_note`, `decided_at`
- `local_reach_publish_events`
  - `id`, `recommendation_id`, `shop_id`, `publish_mode`, `target_url`, `published_by_profile_id`, `published_at`, `verification_jsonb`
- `local_reach_learning_feedback`
  - `id`, `shop_id`, `recommendation_id`, `feedback_type`, `feedback_jsonb`, `created_by_profile_id`, `created_at`

Relationships:

- A recommendation can have many evidence links.
- A recommendation can link to one BSM content approval item for customer review.
- Publish events are append-only so PSG can prove what went live and when.
- Learning feedback never overwrites the original recommendation; it informs future scoring.

## Security And Customer Data Separation Risks

Primary risks and controls:

- Cross-customer leakage: every Local Reach table must include `shop_id`, use row-level security, and follow the existing BSM shop membership pattern.
- Unapproved public changes: MVP uses manual publishing only after a BSM approval decision is recorded.
- Invented or risky claims: reuse the BSM claim-integrity gate and `verified_facts`; no claim ships without backing.
- Unsafe scraping: source registry must record allowed use, robots status, and last check; block restricted sources.
- Copying competitor content: store short evidence summaries and links only; generated content must be original.
- Forum/review personal data: do not store names, handles, phone numbers, emails, or incident details unless already customer-approved and needed.
- Website credential exposure: no WordPress credentials in plain text; future API path must use encrypted credentials and least-privilege application passwords.
- Approval bypass: publishing code, when added later, must require an approved review item and a final pre-publish gate.
- Audit gaps: every recommendation, approval, and publish action needs an append-only event.

## Implementation Recommendation

Proceed with PSG-2040 using the manual-publishing MVP path. Build only the recommendation, evidence, approval linkage, and publish-record pieces first. Do not build automated crawling at scale or direct CMS publishing until the pilot proves source quality and approval workflow reliability.

## Sources Checked

- Repo: `Reference.md`, `README.md`, Graphify runbook, BSM content writer and approval code, BSM content approval migrations.
- Collision Repair Content System skill: local version `0.4.0`.
- RFC 9309 Robots Exclusion Protocol: https://www.rfc-editor.org/info/rfc9309/
- Google robots.txt crawler documentation: https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec
- Firecrawl crawl documentation: https://docs.firecrawl.dev/api-reference/endpoint/crawl-post
- Semrush API usage restrictions: https://developer.semrush.com/api/introduction/api-usage-restrictions/
- Reddit Data API terms/help: https://redditinc.com/policies/data-api-terms and https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- WordPress REST API posts reference: https://developer.wordpress.org/rest-api/reference/posts/
- WordPress application passwords integration guide: https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
- Elementor developer documentation center: https://developers.elementor.com/
