# Phase 4 Context: Customer-facing MVP

## Goals

1. BSM becomes a product someone can pay for. First external paying customers onboarded.
2. Shop owners see a branded dashboard showing what agents are doing and whether it's working.
3. Multi-tenant isolation: each shop sees only their data.
4. Dual approval workflow: agent > PSG > client > publish.
5. Stripe billing with two tiers: Essentials ($199/mo) and Growth ($499/mo).

## Approach

- Next.js App Router with PSG brand design system (Authority Palette + Clarity Teal)
- Supabase Auth with role-based access (owner, manager, admin)
- Multi-tenant PostgreSQL with Row Level Security
- /uncodixfy and /humanizer constraints on all UI and copy
- Content preview from Phase 3 embedded in client dashboard
- Client onboarding wizard with smart defaults (name + address, auto-discover rest)

## Prior Phase Context

Phase 3 delivered:
- Content preview system with real site HTML templates
- Site designer agent that crawls and extracts templates
- Client approval workflow (approve/reject buttons in preview)
- 5-agent Paperclip swarm configured

## Constraints

- Solo builder (Nick) for this phase
- Must use PSG brand guidelines (Authority Palette + Clarity Teal energy)
- No PII handling beyond basic auth (email/password)
- Prove value on existing PSG clients before opening to public
- All content requires human approval before publishing

## Open Questions

- None blocking (answered during init and prior phases)

---
*Created: 2026-04-12 (auto mode)*
