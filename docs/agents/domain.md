# Domain Docs

This repository uses a single-context domain-document layout.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant ADRs under `docs/adr/`.

If either location does not exist, proceed silently. Domain documentation should be created only when terms or architectural decisions are actually resolved.

## File structure

/
├── CONTEXT.md
├── docs/
│   └── adr/
├── apps/
└── packages/

## Use the glossary's vocabulary

When output names a domain concept—including issue titles, proposals, hypotheses, and test names—use the term defined in `CONTEXT.md`. Do not substitute terminology the glossary explicitly avoids.

If a required concept is absent, reconsider whether it belongs to the domain or note the gap for domain-modeling work.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
