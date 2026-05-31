# PSG Paid Acquisition Process Model - Session Handoff

Last updated: 2026-05-27
Owner: Nick Schoolcraft (nick@phoenixsolutionsgroup.net)
Repo: apps/ads

## What this work is

A pair of HTML process-model documents that codify how PSG runs a paid acquisition engagement for collision repair shops (NAICS 81112) end to end. The work started as a single Google Ads lifecycle doc, expanded through five rounds of clarification, and is now split into two synchronized files plus a handoff layer.

## Files produced (live in /Users/schoolcraft_mbpro/apps/ads/)

| File | Purpose | Owner persona |
|------|---------|---------------|
| `process-model-psg-sales-lifecycle.html` | Lead through Closed Won + Commercial Operations forever. 16 sections. | Rex (VP Sales) + Finance Lead |
| `process-model-psg-delivery-lifecycle.html` | Handoff Gate through Renew/Cancel. 18 sections. | Account Strategist + Delivery team |
| `process-model-psg-paid-acquisition-master.html` | Earlier single-doc version (v3.0). Superseded but kept as reference. Can be deleted if no longer wanted. | n/a |
| `process-model-google-ads-lifecycle.html` (in uploads) | Original v1.0 single doc that started this work. Reference only. | n/a |
| `claude-ads-integration.html` (in uploads) | Original claude-ads integration doc. Superseded. Reference only. | n/a |

Both current docs link to each other in the header banner.

## Architectural decisions (the things that took clarification to nail down)

**Two parallel lifecycles, one Handoff Gate.** Sales owns S0-S8. Delivery owns D1-D8. Commercial Ops runs from S7 forward in parallel with Delivery. The Handoff Gate is hard: Delivery does not start until package is built, internal meeting happens, client kickoff is scheduled.

**One job per tool.** This is the persistence boundary that anchors everything:
- Pipedrive owns CRM state (deals, contacts, activities)
- PandaDoc owns signed contracts (PandaDoc only, not Proposify)
- invoiced.app owns billing (with API integration confirmed)
- Asana owns operational tasks (one project per client, created at S7)
- Obsidian owns persistent knowledge (one vault per client, created at S7)
- Sanity + Next.js or Astro own live LP content
- GA4 + GTM (+ sGTM where applicable) + CallRail/WhatConverts own telemetry
- Looker Studio owns reporting dashboards
- googleads_psg owns ad mutations (with dry-run/execute discipline and audit logs)
- claude-ads owns ad audits and recommendations
- SEMrush MCP owns keyword + competitor + site research

**Persona library is hybrid.** 8 PSG canonical collision personas (General, First-Time Victim, Insurance Claimant, Cash-Pay, At-Fault, Repeat, OEM-Certified, OEM-EV) are the starting point. Per-client refinement in D3 reranks based on actual VoC research from D2e.

**Five Phase 4 build streams run in parallel.** D4a analytics, D4b LP build (Sanity), D4c content (uses collision-repair-content-system skill), D4d ads (googleads_psg PAUSED), D4e CRO instrumentation. Dependencies are documented in section 7 of the Delivery doc.

**Four refinement loops run concurrently in D6.** D6a weekly tactical ads, D6b monthly strategic ads, D6c continuous CRO, D6d quarterly content refresh. Each has its own Mermaid flowchart.

**Vault per client, not master vault.** User chose separate Obsidian vault per client (named `psg-[client-slug]-vault`) created at S7 alongside the Asana project. PSG-internal knowledge lives in a separate Obsidian instance.

**Ad spend pass-through model.** PSG fronts ad spend on PSG card on the MCC. At month-end, Finance Lead pulls prior-month spend via `mcp__google-ads-mcp__search`, reconciles against Google Ads invoice (2% tolerance), and appends spend as a separate line item on the client's invoiced.app invoice. Net 30 default, net 15 + ACH autopay required for clients over $5k/month.

## Stack status (confirmed by user)

Installed and configured:
- claude-ads (AgriciDaniel/claude-ads) - verified
- Brightdata MCP - confirmed configured
- Pipedrive - PSG primary CRM
- PandaDoc - contracts and signatures
- invoiced.app - billing with API connection established
- Asana - PM with asana-project-setup skill installed
- Sanity CMS + Next.js or Astro - LP stack
- GA4 + GTM (mix of client-side and sGTM)
- CallRail or WhatConverts - call tracking
- Looker Studio - reporting
- googleads_psg - PSG's internal Python mutation toolkit (see apps/ads/CLAUDE.md)
- claude-obsidian (AgriciDaniel/claude-obsidian) - verified, recommended

Scheduled (user confirmed will install):
- Apollo MCP
- ZoomInfo plugin
- Common Room plugin

Marked "PSG Internal - confirm registry" (visible in installed skills but source repo uncertain):
- searchfit-seo, sanity skill, brand-voice, design, data, marketing, engineering, adobe-for-creativity, sales, small-business, legal, brightdata-plugin
- PSG custom: psg-sales-team, collision-repair-content-system, web-scraping (with 81112 mode), graphic-design-expert, server-maintenance, email-design-system, email-assistant

## Open items the user has not locked down

1. Confirm actual repo URLs for the plugins marked "PSG Internal - confirm registry" so the skill cards in both docs can be filled in
2. Confirm Asana custom field schema (I proposed Phase, Stream, KPI Impact, Audit Log Path, Client Visible)
3. Confirm whether D6 recurring tasks should be Asana templates or Asana recurring task rules
4. Confirm whether PSG-internal Obsidian vault is a separate instance or same instance with folder boundary
5. Confirm Obsidian Sync vs git-based vault sync
6. Confirm ad spend markup vs at-cost (docs currently assume at-cost; many agencies charge 10-15% markup)
7. Confirm sGTM eligibility threshold per client tier
8. Confirm Microsoft Clarity vs Hotjar for heatmaps

## Conventions used in the docs

**File naming.** All files use kebab-case. Process model files start with `process-model-psg-` prefix.

**HTML structure.** Single-file HTML with inline CSS and Mermaid via CDN. Brand colors: `--navy: #0B1F3A`, `--red: #C8102E`, `--amber: #B45309` (sales), `--accent: #1E3A8A` (delivery), `--green: #047857` (commercial), `--pink: #9D174D` (handoff and customer).

**Section numbering.** Both files use sequential `id="sec-N"` anchors and `## N. Title` heading text. Renumber together if inserting new sections.

**Mermaid escape rule (lesson learned).** Any node label containing `:`, `/`, `()`, `;`, or `#` must be wrapped in double quotes like `M4["text with : or /"]`. Unquoted labels with special chars break the parser with "Syntax error in text" rendering. This bit us once in section 8 of the Sales doc when adding Asana and Obsidian nodes.

**Persona references.** When showing the 8 personas, always include traffic-share weighting (Primary 35-45%, etc.) and the anxiety priority order. These are documented in the collision-repair-content-system skill.

**Diagram color conventions.**
- Blue (#DBEAFE / #1E3A8A) for Delivery / Read tasks
- Amber (#FEF3C7 / #B45309) for Sales / Plan tasks
- Red (#FEE2E2 / #C8102E) for Write/mutation tasks
- Green (#D1FAE5 / #047857) for success/verify
- Pink (#FCE7F3 / #9D174D) for customer-voice / Obsidian tasks

## How to continue this work in a future session

1. Read this file first
2. Read `apps/ads/CLAUDE.md` for the repo-level conventions (safety rules around googleads_psg, mutation discipline, etc.)
3. Open the two HTML files in a browser to see current state
4. If the user asks for a change, identify which file or files need updating and whether the change cuts across both
5. If editing diagrams: use the Mermaid escape rule above
6. If renumbering sections: edit `sec-N` ids first (highest to lowest to avoid collisions), then heading text, then TOC labels
7. After every change, present the file(s) using `mcp__cowork__present_files`

## Skills used to produce this work

- anthropic-skills:process-modeling (for BPMN/flowchart standards)
- anthropic-skills:project-manager (for the Asana sections)
- anthropic-skills:humanizer (one pass run; the user's writing preferences pre-filter most AI tells)
- anthropic-skills:collision-repair-content-system (source of the 8 personas and 5 anxieties)
- anthropic-skills:psg-sales-team (source of the 9 sales stages and proposal template)

## User writing preferences (always apply)

- Active voice, practical specific advice, concrete data when possible
- Speak to reader as "you" and "your"
- AVOID em dashes, "not just X but Y", filler phrases, metaphors, hashtags, asterisks
- AVOID "in conclusion", "to sum up", "closing"
- AVOID extra adjectives/adverbs and vague sweeping claims
- Clean concise prose that reads like a human

## Source documents and references

- Original CLAUDE.md: `/Users/schoolcraft_mbpro/apps/ads/CLAUDE.md`
- AgriciDaniel/claude-ads: https://github.com/AgriciDaniel/claude-ads
- AgriciDaniel/claude-obsidian: https://github.com/AgriciDaniel/claude-obsidian
- Smart Insights 7-Steps and SOSTAC framework (referenced in original v1.0 doc)
- Karpathy LLM Wiki pattern: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

## Version history

- v1.0 (2026-05-27 morning): Original `process-model-google-ads-lifecycle.html` and `claude-ads-integration.html`
- v2.0 (2026-05-27): Master consolidated doc with persona work, SEMrush, LP build, CRO, analytics added
- v3.0 (2026-05-27): Split into Sales + Delivery files with two-track structure, Asana, Obsidian, PandaDoc, invoiced.app integration
- v3.1 (2026-05-27): Mermaid syntax fix in Sales section 8; PandaDoc-only cleanup in remaining diagram nodes
