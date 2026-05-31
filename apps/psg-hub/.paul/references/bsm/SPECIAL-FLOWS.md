# Special Flows: BSM

Skills and specialized commands configured for this project.

## Active Skills

| Skill | Purpose | Phase | Trigger |
|-------|---------|-------|---------|
| `/skillsmith` | Build SEO auditor, market researcher, content writer agent skills | Phase 1 | When creating new agent skills |
| `/collision-repair-content-system` | Content creation workflow for collision repair vertical | Phase 1+ | When agents produce client content |
| `/ui-ux-pro-max` | Design system generation, component quality, accessibility | Phase 3+ | When building client dashboard |
| `/uncodixfy` | Prevent AI-looking UI patterns | Phase 3+ | When generating any frontend code |
| `/humanizer` | Ensure agent-produced copy and UI text sounds human | Phase 1+ | When reviewing agent output or writing UI copy |
| `/aegis` | Security audit before customer-facing launch | Phase 3 | Before opening to external users |
| `/frontend-design` | Frontend interface implementation with design quality | Phase 3+ | When building dashboard views |
| `/brand` | PSG brand consistency enforcement | All phases | When producing any visual or written output |
| `/design-system` | Token architecture and component specs from PSG brand guidelines | Phase 3 | When scaffolding the Next.js design system |
| `/firecrawl` | Web scraping for the scraper agent | Phase 1 | When scraper agent needs to crawl sites |
| `/vercel-plugin:vercel-storage` | Supabase and storage configuration on Vercel | Phase 3+ | When configuring Supabase integration |
| `/vercel-plugin:auth` | Supabase Auth integration patterns | Phase 3 | When implementing authentication |
| Google Workspace APIs | Google Search Console, Google Business Profile, Google Ads | Phase 1+ | When integrating Google services per shop |

## Skill Chains

Sequences of skills that fire together for common workflows:

### Agent content production
1. `/humanizer` — review agent output for AI patterns
2. `/collision-repair-content-system` — validate collision repair terminology and voice
3. `/brand` — check PSG brand compliance

### Dashboard development
1. `/design-system` — establish tokens from PSG brand guidelines
2. `/ui-ux-pro-max` — generate design system and component specs
3. `/uncodixfy` — filter out AI-looking patterns
4. `/frontend-design` — implement the views

### Pre-launch audit
1. `/aegis` — security audit (OWASP, RLS, secrets)
2. SonarQube scan — code quality and vulnerabilities
3. Enterprise plan audit — architectural review

---
*Created: 2026-04-11*
