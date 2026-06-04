# Master Project Plan: PSG Agentic Market Intelligence Platform
## GSD & Project Planner Integration

**Prepared by:** Manus AI for Phoenix Solutions Group
**Date:** March 14, 2026

This document fuses the high-level milestones and risk management of the `/project-planner` skill with the atomic, executable prompts of the `/GSD Planner` skill. It provides the exact blueprint for building the platform described in the PRD.

---

## 1. Project Overview

**Goal:** Transform the static Discovery API into a resilient, continuously running agentic intelligence platform powered by BigQuery, Supabase, Yext, and multi-LLM routing.
**Timeline:** 4 Execution Waves (Estimated 6-8 weeks)
**Team:** 1 Visionary/Product Owner (Nick), 1 AI Implementer (Manus)
**Constraints:** Must maintain existing pipeline architecture; must not use bare exceptions; must enforce BigQuery cache-first rules.

---

## 2. Milestones & Delivery Schedule

| # | Milestone | Target | Owner | Success Criteria |
|---|-----------|--------|-------|------------------|
| 1 | Foundation Hardened | End Wave 1 | AI | Pipeline runs 100% on BigQuery with zero bare exceptions and circuit breakers active. |
| 2 | Intelligence Wired | End Wave 2 | AI | Competitor engine accurately scores shops; Yext & Meteostat data successfully cached. |
| 3 | Brain Online | End Wave 3 | AI | Claude generates reports grounded in NotebookLM with zero AI vocabulary. |
| 4 | Platform Launch | End Wave 4 | AI | Supabase dashboard live; PDF export generates print-ready deliverables. |

---

## 3. GSD Execution Prompts (The "Plans")

These are the exact `PLAN.md` prompts the AI will use to execute the work. Each plan is atomic, containing 2-3 tasks maximum to prevent context degradation.

### Wave 1: Foundation (Data & Resilience)

**Plan 1.1: Resilience Layer**
```markdown
---
phase: 1
plan: 1
wave: 1
depends_on: []
files_modified: [src/resilience.py, requirements.txt]
autonomous: true
must_haves:
  truths: ["External calls fail gracefully with exponential backoff"]
  artifacts: ["resilience.py exists with @api_retry and @bq_retry decorators"]
---
<objective>Stop pipeline from failing silently on API timeouts.</objective>
<tasks>
<task type="auto">
  <name>Implement Retry Decorators</name>
  <files>src/resilience.py</files>
  <action>Create @api_retry and @bq_retry using tenacity (3 retries, exp backoff). AVOID bare exceptions.</action>
  <verify>pytest test_resilience.py passes</verify>
  <done>Decorators handle requests.Timeout and GoogleAPICallError</done>
</task>
<task type="auto">
  <name>Implement Circuit Breaker</name>
  <files>src/resilience.py</files>
  <action>Add pybreaker CircuitBreaker class for external providers (fails after 3 errors).</action>
  <verify>pytest test_circuit_breaker.py passes</verify>
  <done>Circuit opens on repeated failures</done>
</task>
</tasks>
```

**Plan 1.2: BigQuery DAL**
```markdown
---
phase: 1
plan: 2
wave: 1
depends_on: []
files_modified: [src/bigquery_client.py]
autonomous: true
must_haves:
  truths: ["All DB queries use parameterized inputs"]
---
<objective>Create the secure interface for all BigQuery interactions.</objective>
<tasks>
<task type="auto">
  <name>Initialize Client</name>
  <files>src/bigquery_client.py</files>
  <action>Initialize google-cloud-bigquery client using GOOGLE_APPLICATION_CREDENTIALS env var.</action>
  <verify>python -c "import src.bigquery_client"</verify>
  <done>Client initializes without errors</done>
</task>
<task type="auto">
  <name>Implement Parameterized Queries</name>
  <files>src/bigquery_client.py</files>
  <action>Write get_zip_data(table, zip_code) using @zip_code parameters. AVOID string interpolation.</action>
  <verify>Run query with test ZIP, check BQ logs for parameterization</verify>
  <done>Function returns data securely</done>
</task>
</tasks>
```

**Plan 1.3: Data Migration**
```markdown
---
phase: 1
plan: 3
wave: 1
depends_on: [1.1, 1.2]
files_modified: [src/data_collection.py]
autonomous: true
must_haves:
  truths: ["Local SQLite and CSV files are no longer used"]
---
<objective>Move off local files and remove bare exceptions.</objective>
<tasks>
<task type="auto">
  <name>Swap Data Sources</name>
  <files>src/data_collection.py</files>
  <action>Replace sqlite3 calls to unified.db/accidents.db with calls to bigquery_client.py.</action>
  <verify>Run pipeline, verify no SQLite errors</verify>
  <done>Pipeline reads from BQ</done>
</task>
<task type="auto">
  <name>Purge Bare Exceptions</name>
  <files>src/data_collection.py</files>
  <action>Replace all 'except Exception:' with specific typed exceptions.</action>
  <verify>grep -r "except Exception:" src/data_collection.py returns 0</verify>
  <done>Zero bare exceptions remain</done>
</task>
</tasks>
```

### Wave 2: Core Intelligence (APIs & Scoring)

**Plan 2.1: Competitor Engine**
```markdown
---
phase: 2
plan: 1
wave: 2
depends_on: [1.3]
files_modified: [src/competitor_engine.py, config/consolidators.yaml]
autonomous: true
must_haves:
  truths: ["Competitors are ranked strictly by the proximity algorithm"]
---
<objective>Build the algorithm that defines the true competitive set.</objective>
<tasks>
<task type="auto">
  <name>Build Consolidator Config</name>
  <files>config/consolidators.yaml</files>
  <action>Create YAML mapping consolidators (Caliber, Gerber, Crash Champions, Joe Hudson -> Gerber).</action>
  <verify>cat config/consolidators.yaml</verify>
  <done>YAML file exists and is parsable</done>
</task>
<task type="auto">
  <name>Implement Scoring Logic</name>
  <files>src/competitor_engine.py</files>
  <action>Rank shops by proximity, consolidator flag, rating, count, website. Return top 3-5.</action>
  <verify>pytest test_competitor_engine.py</verify>
  <done>Joe Hudson shop is forced into top 5 in test case</done>
</task>
</tasks>
```

**Plan 2.2: Yext Integration**
```markdown
---
phase: 2
plan: 2
wave: 2
depends_on: [1.1]
files_modified: [src/yext_client.py, src/orchestrator.py]
autonomous: true
must_haves:
  truths: ["Existing clients use Yext API, prospects use public scan"]
---
<objective>Connect Yext and implement the intake branching logic.</objective>
<tasks>
<task type="auto">
  <name>Create Yext Client</name>
  <files>src/yext_client.py</files>
  <action>Implement GET /v2/accounts/{id}/listings and /reviews wrapped in @api_retry.</action>
  <verify>Run test client against Yext sandbox</verify>
  <done>Client returns valid JSON</done>
</task>
<task type="auto">
  <name>Implement Intake Branching</name>
  <files>src/orchestrator.py</files>
  <action>If is_psg_client=True, pull Yext analytics/reviews. If False, run public scan + Google Places.</action>
  <verify>Run pipeline with is_psg_client=True, verify Google Places is skipped</verify>
  <done>Branching logic routes correctly</done>
</task>
</tasks>
```

**Plan 2.3: Weather Correlation & LLM Routing**
```markdown
---
phase: 2
plan: 3
wave: 2
depends_on: [1.2]
files_modified: [src/weather_client.py, src/llm_router.py]
autonomous: true
must_haves:
  truths: ["Meteostat data correlates with BQ accidents", "Extraction routes to GPT-4o"]
---
<objective>Add weather context and specialized LLM routing.</objective>
<tasks>
<task type="auto">
  <name>Integrate Meteostat</name>
  <files>src/weather_client.py</files>
  <action>Pull historical precipitation data and cross-reference with BQ accident_stats.</action>
  <verify>Run correlation for ZIP 48104</verify>
  <done>Returns valid correlation JSON</done>
</task>
<task type="auto">
  <name>Build LLM Router</name>
  <files>src/llm_router.py</files>
  <action>Create routing logic: Extraction -> OpenAI, Sentiment -> Gemini, Search -> Perplexity.</action>
  <verify>Run test extraction, check logs</verify>
  <done>Request routes to correct provider</done>
</task>
</tasks>
```

### Wave 3: Synthesis (NotebookLM & Claude)

**Plan 3.1: NotebookLM Integration**
```markdown
---
phase: 3
plan: 1
wave: 3
depends_on: [2.3]
files_modified: [src/notebooklm_client.py]
autonomous: false
user_setup:
  - service: NotebookLM
    why: "Proprietary thought leadership grounding"
    task: "Create master notebooks, upload PSG PDFs, tag with 'psg-strategy'"
must_haves:
  truths: ["Agent can query NotebookLM via Python API"]
---
<objective>Connect the agent to PSG's proprietary frameworks using notebooklm-py.</objective>
<tasks>
<task type="checkpoint:human-action">
  <name>Populate Notebooks</name>
  <action>User must manually create NotebookLM notebooks and upload PSG IP.</action>
</task>
<task type="auto">
  <name>Implement API Client</name>
  <files>src/notebooklm_client.py</files>
  <action>Use teng-lin/notebooklm-py to query notebooks. Add session expiry check.</action>
  <verify>Run test query "collision repair strategy"</verify>
  <done>Returns grounded text from NotebookLM</done>
</task>
</tasks>
```

**Plan 3.2: Anthropic Writing Pipeline**
```markdown
---
phase: 3
plan: 2
wave: 3
depends_on: [3.1]
files_modified: [src/synthesis.py, templates/report.j2]
autonomous: true
must_haves:
  truths: ["Final copy contains zero AI vocabulary", "Every section has 4 parts"]
---
<objective>Generate the final report using Claude and the Humanizer prompt.</objective>
<tasks>
<task type="auto">
  <name>Build Humanizer Pipeline</name>
  <files>src/synthesis.py</files>
  <action>Sequence: NotebookLM Context -> Claude Draft -> Humanizer Prompt -> Claude Anti-AI Pass.</action>
  <verify>Generate report, regex scan for "delve"</verify>
  <done>Regex returns 0 matches</done>
</task>
<task type="auto">
  <name>Enforce 4-Part Structure</name>
  <files>templates/report.j2</files>
  <action>Update Jinja templates to require: What it covers, Data analyzed, Why it matters, Score meaning.</action>
  <verify>Inspect generated HTML</verify>
  <done>All 4 headers present in every section</done>
</task>
</tasks>
```

### Wave 4: Delivery (Supabase & PDF)

**Plan 4.1: Supabase & PDF Rebuild**
```markdown
---
phase: 4
plan: 1
wave: 4
depends_on: [3.2]
files_modified: [src/supabase_client.py, src/pdf_generator.py, static/print.css]
autonomous: true
must_haves:
  truths: ["PDF is print-ready", "Reports are secured by RLS"]
---
<objective>Ship the final deliverables to the user.</objective>
<tasks>
<task type="auto">
  <name>Supabase RLS</name>
  <files>src/supabase_client.py</files>
  <action>Initialize GoTrue auth and write SQL migrations for Row Level Security on reports table.</action>
  <verify>Query report with wrong UID</verify>
  <done>Returns empty set</done>
</task>
<task type="auto">
  <name>PDF Generator Rebuild</name>
  <files>src/pdf_generator.py, static/print.css</files>
  <action>Create print.css (page breaks, typography). Use Playwright to render HTML to PDF.</action>
  <verify>Generate test PDF</verify>
  <done>PDF has cover page and no cut-off charts</done>
</task>
</tasks>
```

---

## 4. Dependencies Visualization

```
[1.1 Resilience] ────┐
                     ├──> [1.3 Data Migration] ──> [2.1 Competitor Engine] ──┐
[1.2 BigQuery DAL] ──┘                                                       │
                                                                             │
[1.1 Resilience] ────> [2.2 Yext Integration] ───────────────────────────────┤
                                                                             ├──> [3.1 NotebookLM] ──> [3.2 Anthropic Pipeline] ──> [4.1 Delivery]
[1.2 BigQuery DAL] ──> [2.3 Weather & LLMs] ─────────────────────────────────┘
```
**Critical Path:** BigQuery DAL → Competitor Engine → NotebookLM → Anthropic Pipeline → Delivery.

---

## 5. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| NotebookLM API breaks (undocumented) | High | Med | Resilience layer falls back to generic Claude prompt if notebooklm-py fails. |
| BigQuery costs spike | High | Low | DAL strictly enforces parameterized queries and in-memory run caching. |
| Yext API rate limits | Med | Low | Cache analytics data for 30 days; only sync incremental reviews. |
| Playwright hangs | Med | Med | Enforce strict 30s timeouts in CircuitBreaker; fallback to Trafilatura. |
| User setup delays | High | High | Define NotebookLM population task immediately at project kickoff. |
