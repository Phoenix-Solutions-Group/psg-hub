# PSG Engineering Reference

This document is the starting reference for Body Shop Marketer (BSM), psg-hub,
and future Phoenix Solutions Group (PSG) projects. Use it before making
engineering decisions so work moves forward, does not duplicate existing effort,
and does not regress shipped behavior.

## Source of Truth

Paperclip is the live source of truth for scope, priority, ownership, status,
approvals, and blockers. Repository planning files explain the technical
direction, but they do not override active Paperclip tasks or board decisions.

Use this order when information conflicts:

1. Active Paperclip issue, comments, approvals, and blockers.
2. Current repository code and tests.
3. Current repo documentation and runbooks.
4. Historical planning artifacts and archived source material.

## Before Starting Work

Use this checklist before writing code, changing architecture, or creating a new
workstream:

1. Confirm the assigned Paperclip issue and acceptance criteria.
2. Check whether related work already exists in Paperclip, the repo, or docs.
3. Use Graphify before broad repository reading for code-navigation questions.
4. Read the smallest set of files needed to understand existing conventions.
5. Make the smallest change that advances the task without breaking current
   behavior.
6. Run the focused verification that proves the change.
7. Leave a clear Paperclip update with what changed, how it was checked, and who
   owns the next action.

## Graphify Workflow

Graphify is the approved local code-navigation tool for BSM engineering agents.
Use it before opening many files when asking:

- Where does this behavior live?
- What calls this code?
- What could this change affect?
- Which existing pattern should this new work follow?

Primary runbook: `docs/runbooks/graphify-codebase-graph.md`.

Common commands:

```bash
graphify query "where is shop access checked?" --budget 1500
graphify explain "symbolName"
graphify affected "symbolName"
graphify path "sourceSymbol" "targetSymbol"
```

If `graphify` is not on `PATH`, use the PSG persistent agent install:

```bash
/paperclip/instances/default/companies/a38dde7c-f8ee-4901-804d-bf1d6887dbf0/codex-home/tools/graphify-venv/bin/graphify query "question" --budget 1500
```

Keep Graphify as a developer workflow tool. Do not add it to customer-facing
runtime code, production dependencies, commit hooks, or company-wide installs
without a separate approved task. Use local source-code graphing only; do not
ingest customer files, documents, screenshots, or production data.

## Do Not Duplicate Work

Before creating a new module, migration, task, or document:

- Search Paperclip for related active and completed work.
- Use Graphify to locate related code and dependencies.
- Use `rg` to confirm names, routes, tables, scripts, and tests.
- Check existing runbooks, planning files, and app/package READMEs.
- Extend existing patterns unless there is a clear reason to replace them.

If duplicate work exists, update or extend the existing workstream instead of
starting a parallel one. If the duplicate is owned by another agent, create or
comment on a child issue rather than silently rewriting their work.

## Progress Without Regression

Every change should move the product forward while preserving working behavior.

Required guardrails:

- Do not revert unrelated local changes.
- Do not remove existing behavior unless the task explicitly calls for it.
- Prefer focused fixes over broad rewrites.
- Preserve BSM conventions such as `profile_id` for profile-linked data.
- Keep customer data access tenant-safe: each shop only sees its own records.
- Add or update tests when behavior changes.
- Run the smallest relevant check before marking work complete.

For user-facing changes, include design review where appropriate and a QA pass
before calling the work done. For security-sensitive changes, add security
review before release.

## Core Project References

| Reference | Use |
| --- | --- |
| `README.md` | Monorepo orientation, shared-worktree rules, commands, and active development notes. |
| `apps/psg-hub/README.md` | Current app direction, product surfaces, roadmap, architecture, brand, and quality gates. |
| `projects/psg-hub/PLANNING.md` | Historical SEED planning artifact for the psg-hub vision and decisions. Use for context, not live status. |
| `PLANNING.md` | Project-local planning artifact retained for background. Paperclip wins if it conflicts. |
| `docs/runbooks/graphify-codebase-graph.md` | Graphify install, refresh, and query workflow. |
| `docs/runbooks/git-worktree-workflow.md` | Safe git workflow for the shared repository. |
| `docs/runbooks/supabase-migration-apply.md` | Supabase migration application process. |
| `docs/ci/e2e.md` | End-to-end test guidance. |

## Active Repository Areas

| Path | Purpose |
| --- | --- |
| `apps/psg-hub/` | Main PSG Hub app. This is the active BSM platform target. |
| `apps/psg-ads-mutations/` | Ads and Google Tag Manager mutation tooling. |
| `packages/` | Shared workspace packages and design system integration. |
| `psg-advantage-portal/` | Market intelligence source code being consolidated into psg-hub. |
| `docs/` | Runbooks, specs, source material, and historical PSG materials. Treat customer/source archives carefully. |
| `projects/` | Historical planning artifacts after project graduation. |

## Tooling Reference

| Tool | Use |
| --- | --- |
| Paperclip | Task ownership, status, comments, approvals, blockers, delegation, and audit trail. |
| Graphify | Local code map for navigation, impact checks, and avoiding duplicate implementation. |
| `rg` | Fast text and file search after Graphify narrows the area. |
| pnpm | Workspace package management. Root package manager is `pnpm@9.15.0`. |
| Turborepo | Root build, test, lint, and typecheck orchestration. |
| Next.js | Customer and internal app framework for `apps/psg-hub`. |
| Supabase | Auth, Postgres database, storage, and row-level customer access controls. |
| Stripe | Billing, subscriptions, invoices, and payment records. |
| Sanity | Content and template store. |
| Vercel | Hosting and production deployment for psg-hub. |
| Vercel Sandbox | Python worker runtime for ads mutations and agentic jobs. |
| Vitest | Unit and component test runner. |
| Playwright | End-to-end and browser verification. |
| SendGrid | Transactional email. |
| Twilio | SMS and phone messaging. |
| Lob.com | Print/mail vendor adapter. |
| Google Ads, Google Analytics 4, Google Search Console | Marketing data and reporting integrations. |
| SEMrush, Firecrawl, Yext, BigQuery | Market intelligence, scraping, listings, and internal data research tools. |

## Engineering Decision Rules

When choosing an approach:

- Prefer the codebase's current pattern over a new abstraction.
- Prefer a complete root-cause fix over a patch that hides the issue.
- Prefer a focused migration or adapter over changing a broad contract.
- Keep external API calls resilient with retry and clear failure handling.
- Keep webhooks idempotent so replayed events do not double-apply changes.
- Keep personally identifiable information protected and avoid logging secrets.
- Choose a measurable verification step before starting implementation.

If a decision affects cost, production release, customer data, security,
timeline, or product scope, record the trade-off in Paperclip in plain language.

## Quality Gates

Use the smallest verification that proves the specific change, then expand only
when risk requires it.

Common checks:

```bash
pnpm --filter psg-hub typecheck
pnpm --filter psg-hub lint
pnpm --filter psg-hub test
pnpm --filter psg-hub test:e2e
pnpm graphify:refresh
```

Milestone or release-bound work must include the relevant QA path, security
review where needed, and production deployment confirmation when merged to the
production branch.

## Team Handoff Rules

Use the engineering team instead of carrying every workstream yourself:

- Ravi and Nora own delegated implementation work.
- Tess owns QA plans, regression checks, and verification before shipping.
- Create child issues for independent or long-running work.
- Include owner, acceptance criteria, and status on every workstream.
- Review delegated work instead of silently replacing it.
- Mark blockers with the owner and exact action needed.

## Communication Standard

Board-facing updates must be plain English. State what happened, why it matters,
how it was checked, and what happens next. Define technical terms when they are
unavoidable. Do not make the board infer business impact from engineering
shorthand.
